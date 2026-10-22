#!/usr/bin/env node
/**
 * 构建脚本（Node 版）—— 供 EdgeOne Pages / Vercel / Netlify 在云端执行。
 *
 * 为什么用 Node 而不是 Python：
 *   这些平台的构建环境保证有 Node，但不一定预装 Python。
 *   server.py 的解析器仍然用 Python（只在你本地跑后台），
 *   云端只需要把数据拼成静态站，用 Node 最稳。
 *
 * 作用：static/ 前端 + data/codes.json 数据  →  public/ 静态站
 *
 * 用法：node build.js
 */

'use strict';

const fs = require('fs');
const path = require('path');

const BASE = __dirname;
const STATIC = path.join(BASE, 'static');
const DATA = path.join(BASE, 'data');
const OUT = path.join(BASE, 'public');

function readItems() {
  // 优先 codes.json：保证构建结果 === 仓库里提交的那份数据
  const jsonPath = path.join(DATA, 'codes.json');
  if (fs.existsSync(jsonPath)) {
    const raw = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    const items = Array.isArray(raw) ? raw : (raw.items || []);
    return { items, source: 'data/codes.json' };
  }
  return { items: [], source: '(无数据)' };
}

function copy(src, dest) {
  fs.copyFileSync(path.join(STATIC, src), path.join(OUT, dest));
}

function writeSitemap(items) {
  const urls = ['/'];
  for (const it of items) {
    const code = it.code || '';
    const safe = code.replace(/[^A-Za-z0-9_-]/g, '');
    if (safe) urls.push('/c/' + safe);
  }
  const body = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls.map((u) => `  <url><loc>${u}</loc></url>`),
    '</urlset>',
  ].join('\n');
  fs.writeFileSync(path.join(OUT, 'sitemap.xml'), body, 'utf8');
}

function main() {
  const { items, source } = readItems();
  if (!items.length) {
    console.log('[build] 警告：data/codes.json 没有数据，将生成空站点。');
  }
  console.log(`[build] 数据来源: ${source}  条目数: ${items.length}`);

  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });

  // 1) 静态资源
  for (const f of ['styles.css', 'app.js', '404.html']) copy(f, f);

  // 2) index.html：绝对路径改相对路径 + 强制静态模式
  let html = fs.readFileSync(path.join(STATIC, 'index.html'), 'utf8');
  html = html
    .replace('href="/static/styles.css"', 'href="styles.css"')
    .replace('src="/static/app.js"', 'src="app.js"')
    .replace('<script src="app.js"></script>',
             '<script>window.DF_STATIC = true;</script>\n<script src="app.js"></script>')
    .replace('href="/"', 'href="./"');

  if (html.includes('/static/')) {
    console.log('[build] 警告：index.html 仍有 /static/ 绝对路径，检查一下');
  }
  fs.writeFileSync(path.join(OUT, 'index.html'), html, 'utf8');

  // 3) 数据
  fs.writeFileSync(
    path.join(OUT, 'codes.json'),
    JSON.stringify({ ok: true, total: items.length, items }, null, 0),
    'utf8'
  );

  // 4) sitemap
  writeSitemap(items);

  const files = fs.readdirSync(OUT);
  const size = files.reduce((s, f) => s + fs.statSync(path.join(OUT, f)).size, 0);
  console.log(`[build] 产物目录: ${OUT}`);
  console.log(`[build] 文件数: ${files.length}  总体积: ${(size / 1024).toFixed(1)} KB`);
  console.log('[build] 文件: ' + files.join(', '));
}

try {
  main();
} catch (e) {
  console.error('[build] 失败:', e.message);
  process.exit(1);
}
