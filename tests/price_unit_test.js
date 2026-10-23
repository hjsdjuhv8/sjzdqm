/**
 * 验证后台价格以「万」录入能正确换算并保存。
 */
'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const BASE = process.argv[2] || 'http://127.0.0.1:8000';
const WD = 'D:\\z1383\\deepseak\\deltaforce-codes';
const PW = fs.readFileSync(path.join(WD, 'data', '.admin-password'), 'utf8').trim();

const fails = [];
const check = (n, c, d) => {
  console.log(`[${c ? 'PASS' : 'FAIL'}] ${n}${!c && d ? '  -- ' + String(d) : ''}`);
  if (!c) fails.push(n);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'dfprice-'));
  const cdp = 9401;
  const proc = spawn(EDGE, [
    '--headless=new', '--disable-gpu', '--no-first-run',
    `--remote-debugging-port=${cdp}`, `--user-data-dir=${profile}`,
    '--window-size=1400,1000', 'about:blank',
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

  let id = 0; const pending = new Map();
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result ?? m.error); pending.delete(m.id); }
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
  await send('Page.navigate', { url: BASE + '/admin' });
  await sleep(1800);

  await evl(`document.getElementById('pw').value=${JSON.stringify(PW)};`);
  await evl(`document.getElementById('loginForm').dispatchEvent(new Event('submit',{cancelable:true}));`);
  await sleep(1800);

  console.log('='.repeat(62));
  console.log('1. 后台价格列以「万」显示');
  console.log('='.repeat(62));
  const shown = await evl(`[...document.querySelectorAll('#adminBody input[data-f="price"]')]
                              .slice(0,6).map(i=>i.value).join(',')`);
  console.log('  前几行价格值:', shown);
  check('价格列不再显示 6 位原始数',
    !/[0-9]{6}/.test(String(shown)), shown);
  check('价格列显示为小数值（万）',
    /^[0-9.]*(,[0-9.]*)*$/.test(String(shown).replace(/^,|,$/g,'')), shown);

  console.log();
  console.log('='.repeat(62));
  console.log('2. 录入「万」后保存能正确换算');
  console.log('='.repeat(62));
  // 找一行有价格的，改成 94.5 万，保存，再从接口核对
  const info = await evl(`(() => {
    const inp = document.querySelector('#adminBody input[data-f="price"]');
    const tr = inp.closest('tr');
    return { code: tr.dataset.code, before: inp.value };
  })()`);
  console.log('  选中条目:', info.code, ' 原价(万):', info.before);

  await evl(`(() => {
    const inp = document.querySelector('#adminBody input[data-f="price"]');
    inp.value = '94.5';
    inp.dispatchEvent(new Event('input', {bubbles:true}));
    inp.closest('tr').querySelector('.mini-btn.save').click();
  })()`);
  await sleep(1500);

  // 直接从后端核对实际存入的值
  const api = await evl(`fetch('/api/admin/list').then(r=>r.json()).then(d=>{
    const it = d.items.find(x=>x.code===${JSON.stringify(info.code)});
    return it ? it.price : null;
  })`);

  // evl 不支持 awaitPromise，这里改用同步轮询
  let saved = null;
  for (let i = 0; i < 20; i++) {
    const r = await send('Runtime.evaluate', {
      expression: `fetch('/api/admin/list').then(r=>r.json()).then(d=>{
        const it = d.items.find(x=>x.code===${JSON.stringify(info.code)});
        return JSON.stringify(it ? it.price : null);
      })`,
      returnByValue: true, awaitPromise: true,
    });
    if (r && r.result && r.result.value) {
      try { saved = JSON.parse(r.result.value); } catch (e) {}
      if (saved !== null && saved !== undefined) break;
    }
    await sleep(300);
  }

  check('94.5 万 存为 945000', saved === 945000, `实际存了 ${saved}`);
  check('保存后输入框回填为 94.5',
    await evl(`document.querySelector('#adminBody input[data-f="price"]').value`) === '94.5',
    await evl(`document.querySelector('#adminBody input[data-f="price"]').value`));

  console.log();
  console.log('='.repeat(62));
  console.log('3. 完整数字也应兼容');
  console.log('='.repeat(62));
  await evl(`(() => {
    const inp = document.querySelector('#adminBody input[data-f="price"]');
    inp.value = '750000';
    inp.dispatchEvent(new Event('input', {bubbles:true}));
    inp.closest('tr').querySelector('.mini-btn.save').click();
  })()`);
  await sleep(1500);

  let saved2 = null;
  for (let i = 0; i < 20; i++) {
    const r = await send('Runtime.evaluate', {
      expression: `fetch('/api/admin/list').then(r=>r.json()).then(d=>{
        const it = d.items.find(x=>x.code===${JSON.stringify(info.code)});
        return JSON.stringify(it ? it.price : null);
      })`,
      returnByValue: true, awaitPromise: true,
    });
    if (r && r.result && r.result.value) {
      try { saved2 = JSON.parse(r.result.value); } catch (e) {}
      if (saved2 !== null && saved2 !== undefined) break;
    }
    await sleep(300);
  }
  check('输入 750000 直接存为 750000', saved2 === 750000, `实际 ${saved2}`);

  // 还原原值，别留下测试痕迹
  await evl(`(() => {
    const inp = document.querySelector('#adminBody input[data-f="price"]');
    inp.value = '${info.before}';
    inp.dispatchEvent(new Event('input', {bubbles:true}));
    inp.closest('tr').querySelector('.mini-btn.save').click();
  })()`);
  await sleep(1200);
  console.log('  已还原原价:', info.before);

  ws.close(); proc.kill();
  await sleep(300);
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {}

  console.log();
  console.log('='.repeat(62));
  if (fails.length) { console.log('失败 ' + fails.length + ' 项'); fails.forEach(f => console.log('  -', f)); process.exit(1); }
  console.log('价格「万」单位验证通过 ✓');
})();
