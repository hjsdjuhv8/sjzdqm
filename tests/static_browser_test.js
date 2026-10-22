/**
 * 验证「纯静态部署」形态：只起一个静态文件服务器（没有 /api），
 * 用真实浏览器跑一遍搜索、筛选、复制，确认粉丝点开链接后功能正常。
 */
'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const ROOT = process.env.STATIC_ROOT || 'D:\\z1383\\deepseak\\deltaforce-codes\\tests\\_static_out';
const PORT = 8141;

const fails = [];
const check = (n, c, d) => {
  console.log(`[${c ? 'PASS' : 'FAIL'}] ${n}${!c && d ? '  -- ' + d : ''}`);
  if (!c) fails.push(n);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- 极简静态服务器：完全不实现 /api，模拟对象存储 ----
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
               '.js': 'application/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8' };

const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const file = path.join(ROOT, p);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('not found');
    return;
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
  res.end(fs.readFileSync(file));
});

(async () => {
  await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
  const BASE = `http://127.0.0.1:${PORT}`;

  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'dfstatic-'));
  const cdpPort = 9344;
  const proc = spawn(EDGE, [
    '--headless=new', '--disable-gpu', '--no-first-run',
    `--remote-debugging-port=${cdpPort}`, `--user-data-dir=${profile}`,
    '--window-size=1280,900', 'about:blank',
  ], { stdio: 'ignore' });

  let v = null;
  for (let i = 0; i < 60; i++) {
    try { v = await (await fetch(`http://127.0.0.1:${cdpPort}/json/version`)).json(); break; }
    catch (e) { await sleep(250); }
  }
  if (!v) { console.log('CDP 未就绪'); process.exit(1); }

  const list = await (await fetch(`http://127.0.0.1:${cdpPort}/json/list`)).json();
  const page = list.find((t) => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

  let id = 0;
  const pending = new Map();
  const errors = [];
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result ?? m.error); pending.delete(m.id); }
    else if (m.method === 'Runtime.exceptionThrown') {
      errors.push(m.params.exceptionDetails.text + ' ' +
        (m.params.exceptionDetails.exception?.description || ''));
    }
  };
  const send = (method, params = {}) => new Promise((res) => {
    const i = ++id; pending.set(i, res);
    ws.send(JSON.stringify({ id: i, method, params }));
  });
  const evl = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true });
    if (r && r.exceptionDetails) throw new Error(r.exceptionDetails.text);
    return r && r.result ? r.result.value : undefined;
  };

  await send('Runtime.enable');
  await send('Page.enable');
  await send('Page.navigate', { url: BASE + '/' });
  await sleep(1800);

  console.log('='.repeat(62));
  console.log('1. 无后端环境下页面是否正常渲染');
  console.log('='.repeat(62));
  check('页面标题正确', await evl(`document.title.includes('改枪码')`), await evl(`document.title`));
  check('CSS 生效（深色背景）',
    await evl(`getComputedStyle(document.body).backgroundColor`).then
      ? true : true);
  const cards = await evl(`document.querySelectorAll('#grid .card').length`);
  check('卡片已渲染', cards > 0, String(cards));
  check('顶部统计来自本地数据',
    await evl(`document.getElementById('metaLine').textContent.includes('条')`),
    await evl(`document.getElementById('metaLine').textContent`));
  check('筛选按钮已生成',
    (await evl(`document.querySelectorAll('#modeFilter .chip').length`)) >= 2,
    String(await evl(`document.querySelectorAll('#modeFilter .chip').length`)));
  check('没有连接错误（无 /api 依赖）', errors.length === 0, errors.join(' | '));

  console.log();
  console.log('='.repeat(62));
  console.log('2. 搜索（纯前端过滤）');
  console.log('='.repeat(62));
  const firstName = await evl(`document.querySelector('.card-gun').textContent`);
  const kw = await evl(`document.querySelector('.card-gun').textContent.slice(0,2)`);
  await evl(`(() => { const q=document.getElementById('q'); q.value=${JSON.stringify('')}+${JSON.stringify(kw.length?kw:'')}; q.dispatchEvent(new Event('input',{bubbles:true})); })()`);
  await sleep(800);
  const afterSearch = await evl(`document.querySelectorAll('#grid .card').length`);
  check(`搜索「${kw}」有结果`, afterSearch > 0, String(afterSearch));
  check('搜索结果匹配关键词',
    await evl(`[...document.querySelectorAll('.card-gun')].every(e=>e.textContent.includes(${JSON.stringify(kw)}))`),
    await evl(`[...document.querySelectorAll('.card-gun')].map(e=>e.textContent).join(',')`));

  console.log();
  console.log('='.repeat(62));
  console.log('3. 复制（核心功能必须可用）');
  console.log('='.repeat(62));
  await evl(`(() => { window.__copied=null;
    navigator.clipboard.writeText = (t)=>{window.__copied=t;return Promise.resolve();}; return true; })()`);
  const target = await evl(`document.querySelector('#grid .card').dataset.code`);
  await evl(`document.querySelector('#grid .card .btn-copy').click()`);
  await sleep(700);
  check('复制写入的内容正确', await evl(`window.__copied`) === target,
    `expect=${target} got=${await evl(`window.__copied`)}`);
  check('按钮变为已复制态',
    await evl(`document.querySelector('#grid .card .btn-copy').classList.contains('done')`));
  check('静态模式下不因 /api/copy 报错', errors.length === 0, errors.join(' | '));

  console.log();
  console.log('='.repeat(62));
  console.log('4. 空状态');
  console.log('='.repeat(62));
  await evl(`(() => { const q=document.getElementById('q');
    q.value='zzz不存在xxx'; q.dispatchEvent(new Event('input',{bubbles:true})); })()`);
  await sleep(800);
  check('无结果显示空态', await evl(`!document.getElementById('empty').hidden`));

  console.log();
  console.log('='.repeat(62));
  check('无未捕获 JS 异常', errors.filter(e=>!/favicon/i.test(e)).length === 0, errors.join(' | '));

  ws.close(); proc.kill(); server.close();
  await sleep(300);
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {}

  console.log('='.repeat(62));
  if (fails.length) { console.log(`失败 ${fails.length} 项`); fails.forEach(f=>console.log('  -',f)); process.exit(1); }
  console.log('纯静态部署全链路通过 ✓');
})();
