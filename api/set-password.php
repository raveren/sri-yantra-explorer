<?php
// Command-line helper to change the editor password:
//     php api/set-password.php 'new password'
// Rewrites config.php with a fresh bcrypt hash. Refuses to run over the web.
if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}
$pw = $argv[1] ?? '';
if ($pw === '') {
    fwrite(STDERR, "usage: php api/set-password.php 'new password'\n");
    exit(1);
}
$hash = password_hash($pw, PASSWORD_DEFAULT);
$config = "<?php\n"
    . "// Editor password, stored as a bcrypt hash. Change it with:\n"
    . "//     php api/set-password.php 'new password'\n"
    . "const EDIT_PASSWORD_HASH = " . var_export($hash, true) . ";\n";
file_put_contents(__DIR__ . '/config.php', $config);
echo "password updated (config.php rewritten)\n";
