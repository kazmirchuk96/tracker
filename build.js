#!/usr/bin/env node
'use strict';
// Збирає index.html (самостійна GitHub Pages сторінка) з body.html
// (джерело — вміст <body>...</body> без обгортки <html><head>).
// Обгортка тут — точна копія того, що раніше вставлялось вручну
// (див. CLAUDE.md, розділ "Як збирається фінальний файл").
//
// Використання:
//   node build.js

const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const bodyHtml = fs.readFileSync(path.join(ROOT, 'body.html'), 'utf8');

const HEAD = `<!DOCTYPE html>
<html lang="uk">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
<title>12 тижнів — трекер цілей</title>
<meta name="theme-color" content="#0F0E0A">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="12 тижнів">
<meta name="robots" content="noindex, nofollow">
<style>
  html, body { margin: 0; padding: 0; background: #0F0E0A; }
</style>
</head>
<body>`;

const FOOT = `</body>
</html>
`;

const output = HEAD + bodyHtml + FOOT;
fs.writeFileSync(path.join(ROOT, 'index.html'), output);
console.log('index.html зібрано з body.html (' + output.length + ' символів).');
