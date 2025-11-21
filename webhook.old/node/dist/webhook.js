"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// webhook.ts
const express_1 = __importDefault(require("express"));
const crypto_1 = __importDefault(require("crypto"));
const app = (0, express_1.default)();
// --- TTLキャッシュ ---
const seen = new Map();
const TTL_MS = Number(process.env.DUP_TTL_MS ?? 86400000); // 24h
function seenBefore(id) {
    if (!id)
        return false;
    const now = Date.now();
    for (const [k, exp] of seen)
        if (exp < now)
            seen.delete(k); // GC
    if (seen.has(id))
        return true;
    seen.set(id, now + TTL_MS);
    return false;
}
// ルート単位で生ボディを取得（JSONパースは自前で行う）
app.post("/webhook", express_1.default.raw({ type: "*/*", limit: "1mb" }), (req, res) => {
    const raw = req.body;
    const signature = req.get("X-Line-Signature") ?? "";
    const secret = process.env.LINE_CHANNEL_SECRET ?? "";
    const accessToken = process.env.LINE_CHANNEL_ACCESS_TOKEN ?? "";
    // --- 署名検証（rawで計算）---
    if (!raw || !signature || !secret)
        return res.sendStatus(403);
    const expected = crypto_1.default.createHmac("sha256", secret).update(raw).digest("base64");
    const expBuf = Buffer.from(expected, "utf8");
    const sigBuf = Buffer.from(signature, "utf8");
    if (expBuf.length !== sigBuf.length || !crypto_1.default.timingSafeEqual(expBuf, sigBuf)) {
        return res.sendStatus(403);
    }
    // --- 署名OK：イベント処理を非同期に積む ---
    let body = {};
    try {
        body = JSON.parse(raw.toString("utf8"));
    }
    catch { /* ignore */ }
    const rawSnip = raw.toString("utf8").slice(0, 200);
    for (const ev of body?.events ?? []) {
        // --- 重複検出 ---
        const id = ev?.webhookEventId;
        if (seenBefore(id)) {
            console.info(`[dup] ${id}`);
            continue;
        }
        // 1) Reply "[Node.js] Hello, World!"（軽いので即タスク投入）
        const replyToken = ev?.replyToken;
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
                    });
                    if (!resp.ok)
                        console.warn(`[LINE reply] non-2xx: ${resp.status}`);
                }
                catch (e) {
                    console.warn(`[LINE reply] error: ${e}`);
                }
            });
        }
        // 2) 重い処理／ログは集約
        const evCopy = { ...ev, _rawSnip: rawSnip }; // PHPの substr($raw,0,200) 相当を同梱
        setImmediate(() => doHeavyWork(evCopy));
    }
    // 2秒以内に200
    return res.sendStatus(200);
});
function doHeavyWork(event) {
    // 重い処理やログはこの後で
    const snip = typeof event?._rawSnip === "string" ? event._rawSnip : "";
    const type = event?.type;
    const src = event?.source ?? {};
    const who = src.userId ?? src.groupId ?? src.roomId ?? "-";
    console.info(`[Express] handled: ${snip} | type=${type} src=${who}`);
}
app.disable("x-powered-by"); // 任意：余計なヘッダを隠す
app.listen(Number(process.env.PORT ?? 3000), "0.0.0.0");
//# sourceMappingURL=webhook.js.map