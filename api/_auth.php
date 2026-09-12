<?php
// Shared authentication for the editor endpoints.
//
// Every mutating request must carry the editor password in the X-Edit-Token
// header. It is checked against the bcrypt hash in config.php. Failed
// attempts are throttled per IP (AUTH_MAX_FAILS within a window locks the IP
// for AUTH_LOCK_SECONDS) so short passwords cannot be brute-forced quickly.

// config.php holds the real hash and is git-ignored; a fresh checkout falls
// back to config.example.php (default password 1008) until set-password.php runs.
$__cfg = __DIR__ . '/config.php';
require is_file($__cfg) ? $__cfg : __DIR__ . '/config.example.php';

const AUTH_MAX_FAILS = 5;
const AUTH_LOCK_SECONDS = 600;

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');

function fail(int $code, string $msg): never {
    http_response_code($code);
    echo json_encode(['error' => $msg]);
    exit;
}

// The attempt log is stored as a .php file that exits immediately, so it can
// never be read through the web server even if the directory is listable.
function auth_log_path(): string {
    return dirname(__DIR__) . '/data/authlog.php';
}

function auth_load(): array {
    $path = auth_log_path();
    if (!is_file($path)) return [];
    $raw = file_get_contents($path);
    $nl = strpos($raw, "\n");
    $data = json_decode($nl === false ? '' : substr($raw, $nl + 1), true);
    return is_array($data) ? $data : [];
}

function auth_save(array $log): void {
    $now = time();
    foreach ($log as $ip => $e) {
        if (($e['until'] ?? 0) < $now && ($e['last'] ?? 0) < $now - AUTH_LOCK_SECONDS) unset($log[$ip]);
    }
    @file_put_contents(auth_log_path(), "<?php exit; ?>\n" . json_encode($log), LOCK_EX);
}

function require_edit_auth(): void {
    if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') fail(405, 'POST only');

    $ip = $_SERVER['REMOTE_ADDR'] ?? 'unknown';
    $log = auth_load();
    $entry = $log[$ip] ?? ['fails' => 0, 'until' => 0, 'last' => 0];
    if ($entry['until'] > time()) {
        fail(429, 'too many failed attempts — try again in a few minutes');
    }

    $token = $_SERVER['HTTP_X_EDIT_TOKEN'] ?? '';
    if ($token !== '' && password_verify($token, EDIT_PASSWORD_HASH)) {
        if (isset($log[$ip])) { unset($log[$ip]); auth_save($log); }
        return;
    }

    $entry['fails']++;
    $entry['last'] = time();
    if ($entry['fails'] >= AUTH_MAX_FAILS) {
        $entry['fails'] = 0;
        $entry['until'] = time() + AUTH_LOCK_SECONDS;
    }
    $log[$ip] = $entry;
    auth_save($log);
    fail(403, 'wrong password');
}
