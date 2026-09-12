<?php
// Password check used by the page when ?edit is requested.
// POST with X-Edit-Token: <password>  ->  200 {"ok":true} or 403 / 429.
require __DIR__ . '/_auth.php';
require_edit_auth();
echo '{"ok": true}';
