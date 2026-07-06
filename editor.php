<?php
$html = file_get_contents("editor.html");
$version = time();

$html = preg_replace(
    '/(href|src)="([^"]+\.(?:css|js))"/', 
    '$1="$2?v=' . $version . '"', 
    $html
);

echo $html;
