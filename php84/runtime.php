<?php

header('Content-Type: application/json');
header('Cache-Control: no-store');

$required = [
    'pdo_mysql', 'mbstring', 'gd', 'zip', 'xml', 'curl',
];
$result = [
    'php_version' => PHP_VERSION,
    'sapi' => PHP_SAPI,
    'session_upload_progress' => (bool) ini_get('session.upload_progress.enabled'),
    'expose_php' => (bool) ini_get('expose_php'),
    'extensions' => get_loaded_extensions(),
    'missing_extensions' => array_values(array_filter(
        $required,
        fn ($extension) => !extension_loaded($extension)
    )),
];

if (isset($_FILES['sample']) && $_FILES['sample']['error'] === UPLOAD_ERR_OK) {
    $result['upload_sha256'] = hash_file('sha256', $_FILES['sample']['tmp_name']);
}

$ready = PHP_MAJOR_VERSION === 8
    && PHP_MINOR_VERSION === 4
    && version_compare(PHP_VERSION, '8.4.27', '>=')
    && !$result['missing_extensions']
    && !$result['session_upload_progress']
    && !$result['expose_php'];
http_response_code($ready ? 200 : 503);
echo json_encode($result, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES);
