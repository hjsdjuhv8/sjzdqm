/** 后台登录后截图（宽屏，看表格与档位控件）。 */
'use strict';
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const BASE = process.argv[2] || 'http://127.0.0.1:8902';
const OUT = process.argv[3] || 'C:\\Users\\z1383\\AppData\\Local\\Temp\\dfshot\\admin1.png';
const W = Number(process.argv[4] || 1600);
const H = Number(process.argv[5] || 1200);
const WD = 'D:\\z1383\\deepseak\\deltaforce-codes';
const PW = fs.readFileSync(path.join(WD, 'data', '.admin-password'), 'utf8').trim();

(async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'dfadm-'));
  const cdp = 9456;
  const proc = spawn(EDGE, [
    '--headless=new', '--disable-gpu', '--no-first-run',
    '--remote-debugging-port=' + cdp, '--user-data-dir=' + profile,
    'about:blank',
  ], { stdio: 'ignore' });

  let v = null;
  for (let i = 0; i < 60; i++) {
    try { v = await (await fetch('http://127.0.0.1:' + cdp + '/json/version')).json(); break; }
    catch (e) { await new Promise(r => setTimeout(r, 250)); }
  }
  if (!v) { console.log('CDP 未就绪'); process.exit(1); }

  const list = await (await fetch('http://127.0.0.1:' + cdp + '/json/list')).json();
  const page = list.find(t => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

  let id = 0;
  const pend = new Map();
  ws.onmessage = ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result ?? m.error); pend.delete(m.id); }
  };
  const send = (method, params = {}) => new Promise(r => {
    const i = ++id; pend.set(i, r);
    ws.send(JSON.stringify({ id: i, method, params }));
  });
  const evl = async e => {
    const r = await send('Runtime.evaluate', { expression: e, returnByValue: true });
    if (r && r.exceptionDetails) return 'ERR:' + r.exceptionDetails.text;
    return r && r.result ? r.result.value : undefined;
  };

  await send('Runtime.enable');
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride',
             { width: W, height: H, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: BASE + '/admin' });
  await new Promise(r => setTimeout(r, 2000));

  await evl('document.getElementById("pw").value=' + JSON.stringify(PW) + ';');
  await evl('document.getElementById("loginForm").dispatchEvent(new Event("submit",{cancelable:true}));');
  await new Promise(r => setTimeout(r, 2500));

  const info = {
    loggedIn: await evl('!document.getElementById("adminView").hidden'),
    rows: await evl('document.querySelectorAll("#adminBody tr[data-code]").length'),
    variantBtns: await evl('document.querySelectorAll("#dVariant .variant-btn").length'),
    tierOptions: await evl('document.querySelectorAll("#dPriceTier option").length'),
    hasNotes: await evl('!!document.getElementById("dNotes")'),
    firstRowBtns: await evl('document.querySelectorAll("#adminBody tr .variant-picker .variant-btn").length')
  };
  console.log(JSON.stringify(info, null, 2));

  const shot = await send('Page.captureScreenshot', {
    format: 'png', captureBeyondViewport: true,
    clip: { x: 0, y: 0, width: W, height: H, scale: 1 },
  });
  if (shot && shot.data) {
    fs.writeFileSync(OUT, Buffer.from(shot.data, 'base64'));
    console.log('saved:', OUT, fs.statSync(OUT).size);
  }

  ws.close(); proc.kill();
  await new Promise(r => setTimeout(r, 300));
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {}
})();
