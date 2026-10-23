/**
 * 用 CDP 真实模拟手机视口截图（Edge 无头 + --window-size 不等于移动端视口）。
 */
'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const BASE = process.argv[2] || 'http://127.0.0.1:8000';
const OUT = process.argv[3] || 'C:\\Users\\z1383\\AppData\\Local\\Temp\\dfshot\\m_cdp.png';
const W = Number(process.argv[4] || 390);
const H = Number(process.argv[5] || 1400);

(async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'dfshot2-'));
  const cdp = 9399;
  const proc = spawn(EDGE, [
    '--headless=new', '--disable-gpu', '--no-first-run',
    `--remote-debugging-port=${cdp}`, `--user-data-dir=${profile}`,
    'about:blank',
  ], { stdio: 'ignore' });

  let ok = null;
  for (let i = 0; i < 60; i++) {
    try { ok = await (await fetch(`http://127.0.0.1:${cdp}/json/version`)).json(); break; }
    catch (e) { await new Promise(r => setTimeout(r, 250)); }
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

  await send('Runtime.enable');
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', {
    width: W, height: H, deviceScaleFactor: 2, mobile: true,
  });
  await send('Page.navigate', { url: BASE + '/' });
  await new Promise(r => setTimeout(r, 2600));

  const shot = await send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: true,
    clip: { x: 0, y: 0, width: W, height: H, scale: 1 },
  });

  if (shot && shot.data) {
    fs.writeFileSync(OUT, Buffer.from(shot.data, 'base64'));
    console.log('saved:', OUT, fs.statSync(OUT).size, 'bytes');
  } else {
    console.log('截图失败', JSON.stringify(shot).slice(0, 200));
  }

  ws.close(); proc.kill();
  await new Promise(r => setTimeout(r, 300));
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {}
})();
