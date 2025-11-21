// index.js（署名OKならGASへPOST）
const crypto = require('crypto');

// --- 重複検出用 TTLキャッシュ ---
const seen = new Map(); // id -> expiresAt(ms)
const TTL_MS = Number(process.env.DUP_TTL_MS || 86_400_000); // 既定 24h

function seenBefore(id) {
  if (!id) return false;
  const now = Date.now();

  // 期限切れのGC
  for (const [k, exp] of seen) {
    if (exp < now) seen.delete(k);
  }

  if (seen.has(id)) return true;      // 既に見た id = 重複
  seen.set(id, now + TTL_MS);         // 初回なら登録
  return false;
}

// GASリレーのタイムアウト（ms）※環境変数で上書き可能
const RELAY_TIMEOUT_MS = Number(process.env.RELAY_TIMEOUT_MS || 6000);

exports.line = async (req, res) => {
  const s = process.env.LINE_CHANNEL_SECRET || '';
  const h = req.get('x-line-signature') || '';

  if (!s || !h) {
    console.error('[line] missing secret/signature: secret=%s sig=%s', s ? 'set' : 'empty', h ? 'set' : 'empty');
    return res.status(403).send('signature invalid');
  }

  // 生ボディ（署名計算は rawBody 必須）
  const rawBuf = req.rawBody || Buffer.alloc(0);

  // 署名 = HMAC-SHA256(生ボディ, channel secret) を Base64 にして比較
  const calc = crypto
    .createHmac('sha256', s)
    .update(rawBuf)
    .digest('base64');

  if (!(h.length === calc.length &&
        crypto.timingSafeEqual(Buffer.from(h), Buffer.from(calc)))) {
    console.warn('[line] signature mismatch');
    return res.status(403).send('signature invalid');
  }

  // LINEの推奨：2秒以内に200（以降は非同期でOK）
  res.status(200).send('OK');  // ここでACK

  const raw = rawBuf.toString('utf8');

  // --- ここから：重複検出 ---  
  let firstId = undefined;
  try {
    const body = JSON.parse(raw);
    firstId = body?.events?.[0]?.webhookEventId;
  } catch (_) {
    // パース失敗時は重複判定を諦めてそのまま進む
  }

  if (seenBefore(firstId)) {
    console.info('[dup] skip relay; id=', firstId);
    return; // ここで終了（GASには送らない）
  }
  // --- 重複でなければ、relay実行 ---

  // --- GASへ“本文だけ”を中継（GASは任意ヘッダを読めないため） ---
  const gas = process.env.GAS_WEBAPP_URL; // 必ず /exec を指定
  if (!gas) {
    console.warn('[line] GAS_WEBAPP_URL not set; skip relay');
    return;
  }

  // RELAY_SECRET は任意（未設定なら署名は空）
  const relayKey = process.env.RELAY_SECRET || '';
  const relaySig = relayKey
    ? crypto.createHmac('sha256', relayKey).update(raw).digest('base64')
    : '';

  // GASのコールドスタート対策で一定時間待つ（既にACK済みなのでOK）
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), RELAY_TIMEOUT_MS);

  try {
    const resp = await fetch(gas, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        raw, // LINEの“生JSON文字列”
        meta: {
          relaySignature: relaySig,
          receivedAt: new Date().toISOString(),
        },
      }),
      signal: ac.signal,
    });

    const text = await resp.text().catch(() => '');
    if (!resp.ok) {
      console.error('[relay] non-2xx status=%s body=%s', resp.status, text.slice(0, 200));
    } else {
      console.log('[relay] ok status=%s body=%s', resp.status, text.slice(0, 200));
    }
  } catch (e) {
    // 以前のコードだとeが未定義だったので修正
    console.error('relay failed:', e);
  } finally {
    clearTimeout(timer);
  }
};
