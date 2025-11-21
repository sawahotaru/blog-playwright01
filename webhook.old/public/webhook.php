<?php
// webhook.php FPMあり（Nginx＋PHP-FPM / Apache＋PHP-FPM）

$raw = file_get_contents('php://input');

// ==================== ここから：署名検証（最優先） ====================
$channel_secret = getenv('LINE_CHANNEL_SECRET');            // 環境変数想定
$signature      = $_SERVER['HTTP_X_LINE_SIGNATURE'] ?? '';  // FPMでもここでOK

if (!$channel_secret || !$signature) {
  // デバッグ用ログ：環境変数や署名ヘッダが取れているかを記録
  error_log(sprintf(
    '[webhook.php] missing secret/signature: secret=%s sig=%s',
    $channel_secret ? 'set' : 'empty',
    $signature      ? 'set' : 'empty'
  ));
  http_response_code(403);
  exit;
}

$expected = base64_encode(hash_hmac('sha256', $raw, $channel_secret, true));
if (!hash_equals($expected, $signature)) {                  // タイミング攻撃対策にhash_equals
  http_response_code(403);
  exit;
}
// ==================== ここまで：署名検証 ====================

// ==================== ここから：重複検出 ====================
function seen_before($id, $ttl = 86400)
{
  if (!$id) return false;
  if (function_exists('apcu_add')) {
    return !apcu_add("whid:$id", 1, $ttl);   // 既にあれば true（=重複）
  }
  $dir = sys_get_temp_dir() . '/line-wh-seen';
  if (!is_dir($dir)) @mkdir($dir, 0777, true);
  $f = $dir . '/' . preg_replace('/[^A-Za-z0-9_\-]/', '_', $id);
  $now = time();
  if (is_file($f) && ($now - filemtime($f)) < $ttl) return true;
  @touch($f);
  return false;
}
// ==================== ここまで：重複検出 ====================

// 1) 応答を確定（できるだけ早く200を返す）
http_response_code(200);
header('Content-Type: application/json; charset=UTF-8');
echo '{"status":"ok"}';

// 2) セッションを使っている場合は、ここでロックを解放
if (session_status() === PHP_SESSION_ACTIVE) {
  session_write_close();        // 以降の処理で同一セッションをブロックしない
}

// （任意）PHP-FPMの既知挙動対策として入れる例
ignore_user_abort(true);        // 接続切断後も処理継続したい場合の保険（環境により検討）

// 3) クライアントへレスポンスをフラッシュして接続を閉じる（FPM限定）
if (function_exists('fastcgi_finish_request')) {
  fastcgi_finish_request();
}

// ここから先は“裏側”処理
// ==================== ここから：Replyで "[PHP] Hello, World!" ====================
$access_token = getenv('LINE_CHANNEL_ACCESS_TOKEN');        // 環境変数想定
if ($access_token) {
  $json = json_decode($raw, true);
  $event = $json['events'][0] ?? null;

  // --- 重複検出（返信の前に） ---
  $id = $event['webhookEventId'] ?? null;
  if (seen_before($id)) {
    error_log("[dup] $id");
    return;
  }

  if (isset($event['replyToken'])) {
    $replyToken = $event['replyToken'];

    $payload = json_encode([
      'replyToken' => $replyToken,
      'messages'   => [
        ['type' => 'text', 'text' => '[PHP] Hello, World!']
      ]
    ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);

    $ch = curl_init('https://api.line.me/v2/bot/message/reply');
    curl_setopt_array($ch, [
      CURLOPT_POST           => true,
      CURLOPT_RETURNTRANSFER => true,
      CURLOPT_HTTPHEADER     => [
        'Content-Type: application/json',
        'Authorization: Bearer ' . $access_token,
      ],
      CURLOPT_POSTFIELDS     => $payload,
      CURLOPT_CONNECTTIMEOUT => 2,
      CURLOPT_TIMEOUT        => 5,
    ]);
    $resp = curl_exec($ch);
    $err  = curl_error($ch);
    $code = curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    curl_close($ch);

    // お好みで軽いログ（200系以外やエラー時だけ）
    if ($err || $code < 200 || $code >= 300) {
      error_log(sprintf(
        '[LINE reply] code=%s err=%s resp=%s',
        $code,
        $err ?: '-',
        substr((string)$resp, 0, 200)
      ));
    }
  }
}
// ==================== ここまで：Replyで "Hello, World!" ====================

// 4) （任意）重い処理やログはこの後で
// usleep(200000);
error_log('[FPM] handled: ' . substr($raw ?? '', 0, 200));
