/**
 * 验证后台错误提示是否准确区分：
 *   A. 服务正常 + 会话有效 → 解析成功
 *   B. 服务正常 + 会话过期 → 提示「登录已过期」
 *   C. 服务已停止          → 提示「无法连接后台服务」
 */
'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const WD = 'D:\\z1383\\deepseak\\deltaforce-codes';
const BASE = process.env.TARGET || 'http://127.0.0.1:8000';
const PW = fs.readFileSync(path.join(WD, 'data', '.admin-password'), 'utf8').trim();

const fails = [];
const check = (n, c, d) => {
  console.log(`[${c ? 'PASS' : 'FAIL'}] ${n}${!c && d ? '  -- ' + String(d) : ''}`);
  if (!c) fails.push(n);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'dfadm-'));
  const cdp = 9366;
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
  const goto = async (url) => { await send('Page.navigate', { url }); await sleep(1600); };

  await send('Runtime.enable'); await send('Page.enable');

  // ---------- A. 正常登录并解析 ----------
  console.log('='.repeat(62));
  console.log('A. 正常情况：登录 → 粘贴 → 解析成功');
  console.log('='.repeat(62));
  await goto(BASE + '/admin');
  await evl(`document.getElementById('pw').value=${JSON.stringify(PW)};`);
  await evl(`document.getElementById('loginForm').dispatchEvent(new Event('submit',{cancelable:true}));`);
  await sleep(1500);
  check('登录成功进入主界面', await evl(`!document.getElementById('adminView').hidden`));

  await evl(`document.getElementById('pasteArea').value='腾龙突击步枪-全面战场-6IL87QG013CE082VBOHIS';`);
  await evl(`document.getElementById('parseBtn').click();`);
  await sleep(1200);
  const toastA = await evl(`document.getElementById('toast').textContent`);
  check('解析成功（无错误提示）', !/失败|过期|无法连接/.test(toastA), toastA);
  check('预览区出现 1 条', await evl(`document.querySelectorAll('#previewList .pv-row').length`) === 1,
        await evl(`document.querySelectorAll('#previewList .pv-row').length`));

  // ---------- B. 会话过期 ----------
  console.log();
  console.log('='.repeat(62));
  console.log('B. 会话过期：删掉 session 后再解析');
  console.log('='.repeat(62));
  // 通过后端自身无法删，这里直接销毁浏览器 cookie 模拟"会话失效"
  await send('Network.clearBrowserCookies');
  await evl(`document.getElementById('toast').textContent='';`);
  await evl(`document.getElementById('parseBtn').click();`);
  await sleep(1500);
  const toastB = await evl(`document.getElementById('toast').textContent`);
  check('提示指向登录过期，而不是笼统的「解析失败」',
        /登录已过期|未登录/.test(toastB), toastB);
  check('已切回登录页', await evl(`!document.getElementById('loginView').hidden`));

  // ---------- C. 服务停止 ----------
  console.log();
  console.log('='.repeat(62));
  console.log('C. 服务已停止：fetch 直接失败');
  console.log('='.repeat(62));
  await goto(BASE + '/admin');
  // 拦截 fetch 让它失败，模拟服务未启动
  await evl(`(() => {
    window.fetch = () => Promise.reject(new TypeError('Failed to fetch'));
    return true;
  })()`);
  await evl(`document.getElementById('pw').value='x';`);
  await evl(`document.getElementById('loginForm').dispatchEvent(new Event('submit',{cancelable:true}));`);
  await sleep(900);
  const errC = await evl(`document.getElementById('loginErr').textContent`);
  check('服务不可达时给出明确原因', /无法连接后台服务/.test(errC), errC);

  console.log();
  console.log('='.repeat(62));
  ws.close(); proc.kill();
  await sleep(300);
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {}

  if (fails.length) { console.log('失败 ' + fails.length + ' 项'); fails.forEach(f => console.log('  -', f)); process.exit(1); }
  console.log('错误诊断验证通过 ✓');
})();
