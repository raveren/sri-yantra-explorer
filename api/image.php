<?php
// Image endpoint for the editor: upload (multipart 'file' + 'region') or
// delete (form field 'file' = bare filename) in ../data/images/.
// Requires the X-Edit-Token header, like save.php.

require __DIR__ . '/_auth.php';
require_edit_auth();

const MAX_BYTES = 10 * 1024 * 1024;
const TYPES = ['image/jpeg' => 'jpg', 'image/png' => 'png', 'image/webp' => 'webp'];

$dir = dirname(__DIR__) . '/data/images';
$action = $_POST['action'] ?? 'upload';

if ($action === 'delete') {
    $name = basename($_POST['file'] ?? '');
    if ($name === '' || !preg_match('/^[a-z0-9._-]+$/i', $name)) {
        fail(400, 'bad filename');
    }
    $path = $dir . '/' . $name;
    if (is_file($path) && !unlink($path)) {
        fail(500, 'delete failed');
    }
    echo '{"ok": true}';
    exit;
}

if ($action !== 'upload') {
    fail(400, 'unknown action');
}
if (empty($_FILES['file']) || ($_FILES['file']['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK) {
    fail(400, 'no file uploaded');
}
$tmp = $_FILES['file']['tmp_name'];
if (filesize($tmp) > MAX_BYTES) {
    fail(413, 'file too large');
}
$info = @getimagesize($tmp);
$mime = $info['mime'] ?? '';
if (!isset(TYPES[$mime])) {
    fail(415, 'only JPEG, PNG or WebP images');
}

$region = preg_replace('/[^a-z0-9-]/i', '', $_POST['region'] ?? '') ?: 'img';
$name = $region . '-' . date('Ymd-His') . '-' . bin2hex(random_bytes(3)) . '.' . TYPES[$mime];

if (!is_dir($dir) && !mkdir($dir, 0775, true)) {
    fail(500, 'cannot create data/images');
}
if (!move_uploaded_file($tmp, $dir . '/' . $name)) {
    fail(500, 'write failed — is data/images/ writable by the web server?');
}

echo json_encode(['ok' => true, 'file' => 'data/images/' . $name]);
