<?php
$raw = file_get_contents('php://input');
http_response_code(200);
header('Content-Type: application/json; charset=UTF-8');
echo '{"status":"ok"}';

if (function_exists('fastcgi_finish_request')) {
  fastcgi_finish_request();  // ← 応答を先に返す（FPM限定）
}
usleep(200000);
error_log('[FPM] handled: ' . substr($raw ?? '', 0, 200));
