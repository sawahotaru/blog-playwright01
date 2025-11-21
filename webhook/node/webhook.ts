// webhook.ts
import express from "express"
import crypto from "crypto"

const app = express()

// --- TTLキャッシュ ---
const seen = new Map<string, number>();
const TTL_MS = Number(process.env.DUP_TTL_MS ?? 86_400_000); // 24h

function seenBefore(id?: string): boolean {
  if (!id) return false;
  const now = Date.now();
  for (const [k, exp] of seen) if (exp < now) seen.delete(k); // GC
  if (seen.has(id)) return true;
  seen.set(id, now + TTL_MS);
  return false;
}

// ルート単位で生ボディを取得（JSONパースは自前で行う）
app.post("/webhook", express.raw({ type: "*/*", limit: "1mb" }), (req, res) => {
  const raw = req.body as Buffer
  const signature = req.get("X-Line-Signature") ?? ""
  const secret = process.env.LINE_CHANNEL_SECRET ?? ""
  const accessToken = process.env.LINE_CHANNEL_ACCESS_TOKEN ?? ""

  // --- 署名検証（rawで計算）---
  if (!raw || !signature || !secret) return res.sendStatus(403)

  const expected = crypto.createHmac("sha256", secret).update(raw).digest("base64")
  const expBuf = Buffer.from(expected, "utf8")
  const sigBuf = Buffer.from(signature, "utf8")
  if (expBuf.length !== sigBuf.length || !crypto.timingSafeEqual(expBuf, sigBuf)) {
    return res.sendStatus(403)
  }

  // --- 署名OK：イベント処理を非同期に積む ---
  let body: any = {}
  try { body = JSON.parse(raw.toString("utf8")) } catch { /* ignore */ }

  const rawSnip = raw.toString("utf8").slice(0, 200)

  for (const ev of body?.events ?? []) {
    // --- 重複検出 ---
    const id: string | undefined = ev?.webhookEventId;
    if (seenBefore(id)) { console.info(`[dup] ${id}`); continue; }

    // 1) Reply "[Node.js] Hello, World!"（軽いので即タスク投入）
    const replyToken: string | undefined = ev?.replyToken
    if (replyToken && accessToken) {
      setImmediate(async () => {
        try {
          const resp = await fetch("https://api.line.me/v2/bot/message/reply", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${accessToken}`,
            },
            body: JSON.stringify({
              replyToken,
              messages: [{ type: "text", text: "[Node.js] Hello, World!" }],
            }),
          })
          if (!resp.ok) console.warn(`[LINE reply] non-2xx: ${resp.status}`)
        } catch (e) {
          console.warn(`[LINE reply] error: ${e}`)
        }
      })
    }

    // 2) 重い処理／ログは集約
    const evCopy = { ...ev, _rawSnip: rawSnip }     // PHPの substr($raw,0,200) 相当を同梱
    setImmediate(() => doHeavyWork(evCopy))
  }

  // 2秒以内に200
  return res.sendStatus(200)
})

function doHeavyWork(event: any) {
  // 重い処理やログはこの後で
  const snip = typeof event?._rawSnip === "string" ? event._rawSnip : ""
  const type = event?.type
  const src  = event?.source ?? {}
  const who  = src.userId ?? src.groupId ?? src.roomId ?? "-"
  console.info(`[Express] handled: ${snip} | type=${type} src=${who}`)
}

app.disable("x-powered-by") // 任意：余計なヘッダを隠す
app.listen(Number(process.env.PORT ?? 3000), "0.0.0.0")