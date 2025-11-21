// index.js（署名認証OKならGASへPOST）
const crypto = require('crypto');

// ==== ここから：Webhookの重複チェック用TTLキャッシュ（単一インスタンス前提の簡易実装）====
const TTL_MS = Number(process.env.DUP_TTL_MS || 86_400_000); // 既定 24h
const seen = new Map(); // id -> expiresAt(ms)
function seenBefore(id) {
  if (!id) return false;
  const now = Date.now();
  for (const [k, exp] of seen) if (exp < now) seen.delete(k); // 有効期限切れのIDを掃除
  if (seen.has(id)) return true;   // 既に処理済みなら重複とみなす
  seen.set(id, now + TTL_MS);      // 初回のIDは期限付きで保存
  return false;
}
// [Note] 水平スケール時は次回以降の記事（Push編）でRedis等に差し替え推奨。
// ==== ここまで：Webhookの重複チェック用TTLキャッシュ ====


exports.line = async (req, res) => {
  const s = process.env.LINE_CHANNEL_SECRET || '';
  const h = req.get('x-line-signature') || '';
  if (!s || !h) return res.status(403).send('signature invalid');

  // ==== ここから：LINE公式どおりの署名検証（生ボディ + HMAC-SHA256 + Base64）====
  // 生ボディを一度 rawBuf に束ねておき、署名検証とJSONパースの両方で同じ“未加工データ”を使い回す
  const rawBuf = req.rawBody || Buffer.alloc(0);
  const calc = crypto.createHmac('sha256', s)
                     .update(rawBuf)
                     .digest('base64');
  if (!(h.length === calc.length &&
        crypto.timingSafeEqual(Buffer.from(h), Buffer.from(calc)))) {
    return res.status(403).send('signature invalid');
  }
  // ==== ここまで：署名検証 ====


  // LINEの推奨：2秒以内に200（以降は非同期でOK）
  res.status(200).send('OK');  // ここでACK（まず返すのが重要）

  // --- GASへ“本文だけ”を中継（GASは任意ヘッダを読めないため） ---
  const gas = process.env.GAS_WEBAPP_URL; // 必ず /exec を指定
  if (!gas) return;

  // ==== ここから：受信JSONのパースと、重複イベントの除外ロジック ====
  let payload = {};
  try { payload = JSON.parse(rawBuf.toString('utf8') || '{}'); } catch { payload = {}; }
  const events = Array.isArray(payload.events) ? payload.events : [];

  // webhookEventId を使って、すでに処理済みのイベントをスキップする
  const fresh = [];
  for (const ev of events) {
    const id = ev && ev.webhookEventId;
    if (seenBefore(id)) {
      console.info('[dup] skip', id);
      continue;                 // 重複イベントはGASに送らない
    }
    fresh.push(ev);
  }
  if (fresh.length === 0) return; // すべて重複なら何も中継しない
  payload.events = fresh;

  // GASに渡す raw は「重複除外後のJSON文字列」に差し替える
  const raw = JSON.stringify(payload);
  // ==== ここまで：受信JSONのパースと重複除外 ====


  const relayKey = process.env.RELAY_SECRET || '';
  const relaySig = relayKey
    ? crypto.createHmac('sha256', relayKey).update(raw).digest('base64')
    : '';

  // ==== ここから：GASへのリレー（タイムアウト付きで安全に投げる）====
  // GASのコールドスタート対策として最大6秒だけ待つ（Webhook本体はすでにACK済みなのでOK）
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 6000);

  try {
    await fetch(gas, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        raw, // 重複除外後のJSON文字列をそのまま渡す
        meta: { relaySignature: relaySig, receivedAt: new Date().toISOString() }
      }),
      signal: ac.signal
    });
  } catch (e) {
    console.error('relay failed:', e); // 失敗時は例外内容をログに残す
  } finally {
    clearTimeout(t);                   // タイマー完了処理
  }
  // ==== ここまで：GASへのリレー処理 ====
};
