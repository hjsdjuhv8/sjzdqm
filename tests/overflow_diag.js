/**
 * 诊断移动端横向溢出：逐元素测量 scrollWidth，找出真凶。
 */
'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const BASE = process.argv[2] || 'http://127.0.0.1:8000';

(async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'dfov-'));
  const cdp = 9388;
  const proc = spawn(EDGE, [
    '--headless=new', '--disable-gpu', '--no-first-run',
    `--remote-debugging-port=${cdp}`, `--user-data-dir=${profile}`,
    '--window-size=390,900', 'about:blank',
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
  const evl = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true });
    if (r && r.exceptionDetails) return 'ERR:' + r.exceptionDetails.text;
    return r && r.result ? r.result.value : undefined;
  };

  await send('Runtime.enable'); await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', {
    width: 390, height: 844, deviceScaleFactor: 1, mobile: true,
  });
  await send('Page.navigate', { url: BASE + '/' });
  await new Promise(r => setTimeout(r, 2200));

  const info = await evl(`(() => {
    const vw = document.documentElement.clientWidth;
    const out = { viewport: vw,
                  docScroll: document.documentElement.scrollWidth,
                  bodyScroll: document.body.scrollWidth,
                  offenders: [] };
    const all = document.querySelectorAll('body *');
    for (const e of all) {
      const r = e.getBoundingClientRect();
      if (r.right > vw + 1 || r.left < -1) {
        out.offenders.push({
          tag: e.tagName.toLowerCase(),
          cls: (e.className && e.className.toString ? e.className.toString() : '').slice(0, 50),
          id: e.id || '',
          left: Math.round(r.left), right: Math.round(r.right), w: Math.round(r.width),
          scrollW: e.scrollWidth
        });
      }
    }
    out.offenders = out.offenders.slice(0, 25);
    return out;
  })()`);

  console.log('视口宽度:', info.viewport);
  console.log('文档 scrollWidth:', info.docScroll);
  console.log('body scrollWidth:', info.bodyScroll);
  console.log('溢出元素数:', info.offenders.length);
  console.log('');
  for (const o of info.offenders) {
    console.log(`  <${o.tag}> id=${o.id || '-'} class="${o.cls}"  left=${o.left} right=${o.right} w=${o.w}`);
  }

  ws.close(); proc.kill();
  await new Promise(r => setTimeout(r, 300));
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {}
})();
