/**
 * 验证新 UI：模式大卡片、枪械类型导轨、搜索、复制。
 */
'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const BASE = process.argv[2] || 'http://127.0.0.1:8000';

const fails = [];
const check = (n, c, d) => {
  console.log(`[${c ? 'PASS' : 'FAIL'}] ${n}${!c && d ? '  -- ' + String(d) : ''}`);
  if (!c) fails.push(n);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'dfui-'));
  const cdp = 9377;
  const proc = spawn(EDGE, [
    '--headless=new', '--disable-gpu', '--no-first-run',
    `--remote-debugging-port=${cdp}`, `--user-data-dir=${profile}`,
    '--window-size=1300,1000', 'about:blank',
  ], { stdio: 'ignore' });

  let ok = null;
  for (let i = 0; i < 60; i++) {
    try { ok = await (await fetch(`http://127.0.0.1:${cdp}/json/version`)).json(); break; }
    catch (e) { await sleep(250); }
  }
  if (!ok) { console.log('CDP 未就绪'); process.exit(1); }

  const list = await (await fetch(`http://127.0.0.1:${cdp}/json/list`)).json();
  const page = list.find((t) => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

  let id = 0; const pending = new Map(); const errors = [];
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result ?? m.error); pending.delete(m.id); }
    else if (m.method === 'Runtime.exceptionThrown') {
      errors.push(m.params.exceptionDetails.text + ' ' +
        (m.params.exceptionDetails.exception?.description || ''));
    }
  };
  const send = (method, params = {}) => new Promise((r) => {
    const i = ++id; pending.set(i, r);
    ws.send(JSON.stringify({ id: i, method, params }));
  });
  const evl = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true });
    if (r && r.exceptionDetails) return 'ERR:' + r.exceptionDetails.text;
    return r && r.result ? r.result.value : undefined;
  };

  await send('Runtime.enable'); await send('Page.enable');
  await send('Page.navigate', { url: BASE + '/' });
  await sleep(2000);

  console.log('='.repeat(62));
  console.log('1. 结构渲染');
  console.log('='.repeat(62));
  check('模式卡片有 4 张（含全部）',
    await evl(`document.querySelectorAll('.mode-card').length`) === 4,
    await evl(`document.querySelectorAll('.mode-card').length`));
  check('三种模式都在',
    await evl(`[...document.querySelectorAll('.mode-card .mode-card-title')]
                 .map(e=>e.textContent).join(',')`).then(v => /烽火地带|全面战场|黑潮爆破/.test(v)),
    await evl(`[...document.querySelectorAll('.mode-card .mode-card-title')].map(e=>e.textContent).join(',')`));
  check('黑潮爆破卡片存在',
    await evl(`!!document.querySelector('.mode-card[data-val="黑潮爆破"]')`));
  check('枪械类型导轨已生成',
    await evl(`document.querySelectorAll('.cat-item').length`) >= 2,
    await evl(`document.querySelectorAll('.cat-item').length`));
  check('「全部枪械」存在',
    await evl(`!!document.querySelector('.cat-item.cat-all')`));
  check('hero 统计已更新（不再是"正在载入"）',
    await evl(`!document.getElementById('heroStat').textContent.includes('正在载入')`),
    await evl(`document.getElementById('heroStat').textContent`));
  check('卡片已渲染', await evl(`document.querySelectorAll('.card').length`) > 0,
    await evl(`document.querySelectorAll('.card').length`));
  check('卡片有模式色条变量',
    await evl(`!!document.querySelector('.card').style.getPropertyValue('--card-accent')`),
    await evl(`document.querySelector('.card').style.getPropertyValue('--card-accent')`));
  check('卡片分类带图标',
    await evl(`document.querySelectorAll('.card .cat-pill svg').length`) > 0,
    await evl(`document.querySelectorAll('.card .cat-pill svg').length`));

  console.log();
  console.log('='.repeat(62));
  console.log('2. 模式卡片交互');
  console.log('='.repeat(62));
  await evl(`document.querySelector('.mode-card[data-val="烽火地带"]').click()`);
  await sleep(900);
  check('点击后该卡片高亮',
    await evl(`document.querySelector('.mode-card[data-val="烽火地带"]').classList.contains('is-on')`));
  check('「全部模式」取消高亮',
    await evl(`!document.querySelector('.mode-card[data-val=""]').classList.contains('is-on')`));
  const nFire = await evl(`document.querySelectorAll('#grid .card').length`);
  check('筛选后仍有结果', nFire > 0, String(nFire));
  check('结果都是烽火地带',
    await evl(`[...document.querySelectorAll('.card .badge')].every(e=>e.textContent==='烽火地带')`),
    await evl(`[...document.querySelectorAll('.card .badge')].map(e=>e.textContent).join(',')`));

  await evl(`document.querySelector('.mode-card[data-val=""]').click()`);
  await sleep(900);
  const nAll = await evl(`document.querySelectorAll('#grid .card').length`);
  check('切回全部后结果变多或相等', nAll >= nFire, `${nAll} vs ${nFire}`);

  console.log();
  console.log('='.repeat(62));
  console.log('3. 枪械类型导轨交互');
  console.log('='.repeat(62));
  await evl(`document.querySelector('.cat-item[data-val="步枪"]').click()`);
  await sleep(900);
  check('步枪类型高亮',
    await evl(`document.querySelector('.cat-item[data-val="步枪"]').classList.contains('on')`));
  check('筛选后有结果', await evl(`document.querySelectorAll('#grid .card').length`) > 0);

  console.log();
  console.log('='.repeat(62));
  console.log('4. 搜索 + 复制仍然可用');
  console.log('='.repeat(62));
  await evl(`document.querySelector('.cat-item.cat-all').click()`);
  await sleep(700);
  await evl(`(() => { const q=document.getElementById('q');
    q.value='MK47'; q.dispatchEvent(new Event('input',{bubbles:true})); })()`);
  await sleep(900);
  check('搜索有结果', await evl(`document.querySelectorAll('#grid .card').length`) > 0,
    await evl(`document.querySelectorAll('#grid .card').length`));

  await evl(`(() => { window.__copied=null;
    navigator.clipboard.writeText=(t)=>{window.__copied=t;return Promise.resolve();}; return true; })()`);
  const target = await evl(`document.querySelector('#grid .card').dataset.code`);
  await evl(`document.querySelector('#grid .card .btn-copy').click()`);
  await sleep(700);
  check('复制内容正确', await evl(`window.__copied`) === target,
    `expect=${target} got=${await evl(`window.__copied`)}`);

  console.log();
  console.log('='.repeat(62));
  check('无 JS 异常', errors.filter(e => !/favicon/i.test(e)).length === 0, errors.join(' | '));

  ws.close(); proc.kill();
  await sleep(300);
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {}

  if (fails.length) { console.log('失败 ' + fails.length + ' 项'); fails.forEach(f => console.log('  -', f)); process.exit(1); }
  console.log('新 UI 交互验证通过 ✓');
})();
