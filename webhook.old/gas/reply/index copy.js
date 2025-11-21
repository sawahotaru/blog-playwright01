// index.js（署名OKならGASへPOST）
const crypto = require('crypto');

exports.line = async (req, res) => {
  const s = process.env.LINE_CHANNEL_SECRET || '';
  const h = req.get('x-line-signature') || '';
  if (!s || !h) return res.status(403).send('signature invalid');

  // 署名 = HMAC-SHA256(生ボディ, channel secret) を Base64 にして比較
  const calc = crypto.createHmac('sha256', s)
                     .update(req.rawBody || Buffer.alloc(0))
                     .digest('base64');
  if (!(h.length === calc.length &&
        crypto.timingSafeEqual(Buffer.from(h), Buffer.from(calc)))) {
    return res.status(403).send('signature invalid');
  }

  // LINEの推奨：2秒以内に200（以降は非同期でOK）
  res.status(200).send('OK');  // ここでACK。:contentReference[oaicite:2]{index=2}

  // --- GASへ“本文だけ”を中継（GASは任意ヘッダを読めないため） ---
  const gas = process.env.GAS_WEBAPP_URL; // 必ず /exec を指定
  if (!gas) return;

  const raw = (req.rawBody || Buffer.alloc(0)).toString('utf8');
  const relayKey = process.env.RELAY_SECRET || '';
  const relaySig = relayKey
    ? crypto.createHmac('sha256', relayKey).update(raw).digest('base64')
    : '';

  // GASのコールドスタート対策で 6 秒待つ（既にACK済みなので可）
  const ac = new AbortController();
  setTimeout(() => ac.abort(), 6000);

  try {
    await fetch(gas, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        raw, // LINEの“生JSON文字列”
        meta: { relaySignature: relaySig, receivedAt: new Date().toISOString() }
      }),
      signal: ac.signal
    });
  } catch { console.error('relay failed:', e) }
};
