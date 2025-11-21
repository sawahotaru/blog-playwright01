# app.py
from flask import Flask, request, Response
from concurrent.futures import ThreadPoolExecutor
import atexit, os, json, logging
import hmac, hashlib, base64
import time
from urllib.request import Request, urlopen
from urllib.error import URLError, HTTPError

# ---- ログ設定：環境変数 LOG_LEVEL でログレベルを切り替えられるようにしておく ----
logging.basicConfig(
    level=getattr(logging, os.getenv("LOG_LEVEL", "INFO"), logging.INFO)
)

# ---- LINEチャネル情報：環境変数から読み込む想定 ----
LINE_CHANNEL_SECRET = os.getenv("LINE_CHANNEL_SECRET")
LINE_ACCESS_TOKEN   = os.getenv("LINE_CHANNEL_ACCESS_TOKEN")

# ---- Webhookの重複検出用メモリキャッシュ（webhookEventIdごとにTTL付きで保持）----
SEEN = {}
TTL  = int(os.getenv("DUP_TTL", "86400"))  # 既定は24時間（秒単位）

def seen_before(_id: str) -> bool:
    """Webhookの重複（再送）を検出する簡易キャッシュ"""
    if not _id:
        return False
    now = time.time()
    # 期限切れエントリをGC
    for k, exp in list(SEEN.items()):
        if exp < now:
            del SEEN[k]
    # 既に見たIDなら True（=重複）
    if _id in SEEN:
        return True
    # 初回のIDなら、期限付きで登録して False を返す
    SEEN[_id] = now + TTL
    return False

def reply_hello(reply_token: str):
    """Replyで実装：[Python] Hello, World! を1メッセージ返す"""
    if not (reply_token and LINE_ACCESS_TOKEN):
        return
    payload = {
        "replyToken": reply_token,
        "messages": [{"type": "text", "text": "[Python] Hello, World!"}]
    }
    req = Request(
        "https://api.line.me/v2/bot/message/reply",
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {LINE_ACCESS_TOKEN}",
        },
        method="POST",
    )
    try:
        with urlopen(req, timeout=5) as resp:
            if not (200 <= resp.getcode() < 300):
                logging.warning("LINE reply non-2xx: %s", resp.getcode())
    except (HTTPError, URLError) as e:
        logging.warning("LINE reply error: %s", e)

# ---- “重い処理／ログ置き場”：本番ではここに業務ロジックやDB処理を集約する ----
def do_heavy_work(event: dict):
    # （任意）重い処理やログはこの後で
    snip = event.pop("_raw_snip", None)
    if snip is None:
        # フォールバック：イベント全体から概要を文字列化
        try:
            snip = json.dumps(event, ensure_ascii=False)[:200]
        except Exception:
            snip = str(event)[:200]

    evt_type = event.get("type")
    src      = event.get("source", {})
    who      = src.get("userId") or src.get("groupId") or src.get("roomId") or "-"
    logging.info("[Flask] handled: %s | type=%s src=%s", snip, evt_type, who)

# ---- アプリ本体の準備：ボディ上限＆スレッドプールなど ----
app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 1 * 1024 * 1024  # 受信上限1MB（それ以上は413）

EXEC = ThreadPoolExecutor(max_workers=int(os.getenv("WORKERS", "4")))
atexit.register(EXEC.shutdown, wait=False)

@app.post("/webhook")
def webhook():
    # ---- 署名検証：生のリクエストボディとヘッダからHMAC-SHA256 + Base64をチェック ----
    raw = request.get_data(cache=False)  # bytesのまま取得（JSONパース前）
    signature = request.headers.get("X-Line-Signature", "")
    if not (LINE_CHANNEL_SECRET and signature and raw is not None):
        return Response(status=403)

    expected = base64.b64encode(
        hmac.new(LINE_CHANNEL_SECRET.encode("utf-8"), raw, hashlib.sha256).digest()
    ).decode("utf-8")
    if not hmac.compare_digest(expected, signature):
        return Response(status=403)

    # ---- 署名OK → JSONパースしてeventsを取り出し、後処理は非同期へ ----
    body = json.loads(raw.decode("utf-8") or "{}")
    raw_snip = raw.decode("utf-8", errors="replace")[:200]  # ログ用スニペット（先頭200文字だけ）

    for ev in body.get("events", []):
        # --- Webhook再送対策：webhookEventIdで重複をスキップ ---
        _id = ev.get("webhookEventId")
        if seen_before(_id):
            logging.info("[dup] %s", _id)
            continue

        # --- replyToken があるイベントには、軽量なReply APIを並列で投げる ---
        reply_token = ev.get("replyToken")
        if reply_token:
            EXEC.submit(reply_hello, reply_token)

        # --- 本番用の重い処理（DB・外部APIなど）は別スレッドに ---
        ev = dict(ev)              # 元のイベントを書き換えないようにコピー
        ev["_raw_snip"] = raw_snip # 署名済みrawの一部をログ用として添付
        EXEC.submit(do_heavy_work, ev)

    # ---- LINE側の再送を防ぐため、重い処理とは切り離して200をすばやく返す ----
    return Response(status=200)

#   gunicorn app:app -w 2 -k gthread -b 0.0.0.0:8000
if __name__ == "__main__":
    # 本番用：python app.py で直接起動（ポートは8000で設定）
    app.run(host="0.0.0.0", port=8000, debug=True)

