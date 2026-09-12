<?php
// Save endpoint for the Sri Yantra Explorer editor.
// POST JSON here with header X-Edit-Token; writes ../data/regions.json
// and keeps the last 30 timestamped backups in ../data/backups/.

require __DIR__ . '/_auth.php';
require_edit_auth();

const MAX_BYTES = 20 * 1024 * 1024;
const KEEP_BACKUPS = 30;

$body = file_get_contents('php://input');
if ($body === false || $body === '') {
    fail(400, 'empty body');
}
if (strlen($body) > MAX_BYTES) {
    fail(413, 'too large');
}

$decoded = json_decode($body, true);
if (json_last_error() !== JSON_ERROR_NONE || !is_array($decoded)
        || !isset($decoded['meta'], $decoded['groups'], $decoded['regions'])) {
    fail(400, 'invalid regions JSON');
}

$dataFile = dirname(__DIR__) . '/data/regions.json';
$backupDir = dirname(__DIR__) . '/data/backups';

if (file_exists($dataFile)) {
    if (!is_dir($backupDir) && !mkdir($backupDir, 0775, true)) {
        fail(500, 'cannot create backup dir');
    }
    if (!copy($dataFile, $backupDir . '/regions-' . date('Ymd-His') . '.json')) {
        fail(500, 'backup failed');
    }
    $backups = glob($backupDir . '/regions-*.json') ?: [];
    sort($backups);
    foreach (array_slice($backups, 0, max(0, count($backups) - KEEP_BACKUPS)) as $old) {
        @unlink($old);
    }
}

if (file_put_contents($dataFile, $body, LOCK_EX) === false) {
    fail(500, 'write failed — is data/ writable by the web server?');
}

echo '{"ok": true}';
