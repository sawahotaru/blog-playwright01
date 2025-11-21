<?php
// webhook_cgi.php  （CGI版の想定：共用レンタルサーバー等）

// 受信ボディ（必要に応じてログ等で使う）
$raw = file_get_contents('php://input');

// 1) できるだけ早く 200 を返す
http_response_code(200);
header('Content-Type: application/json; charset=UTF-8');
echo '{"status":"ok"}';

// 2) セッションを使っている場合は、ここでロックを解放
//    （以降の並行アクセスをブロックしないため）
if (session_status() === PHP_SESSION_ACTIVE) {
  session_write_close();
}

// 3) （任意）出力バッファやサーバ側バッファをフラッシュ
//    ※ サーバやブラウザのバッファリング設定によっては即時送出されないこともあり
if (function_exists('ob_get_level') && ob_get_level() > 0) {
  @ob_flush();
}
flush();

// 4) 必要に応じて軽いログだけ書いて終わる（ここより後で重い処理はしない）
error_log('[CGI] handled: ' . substr($raw ?? '', 0, 200));

// 5) CGI/mod_php では応答後に継続実行は基本できないので終了
exit;
