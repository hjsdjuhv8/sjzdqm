/** 核实前台卡片能否正确显示 配装档位 / 造价档位 / 备注。 */
'use strict';
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const BASE = process.argv[2] || 'http://127.0.0.1:8902';
const WD = 'D:\\z1383\\deepseak\\deltaforce-codes';
const PW = fs.readFileSync(path.join(WD, 'data', '.admin-password'), 'utf8').trim();

const fails = [];
const check = (n, c, d) => {
  console.log(`[${c ? 'PASS' : 'FAIL'}] ${n}${!c && d ? '  -- ' + d : ''}`);
  if (!c) fails.push(n);
};
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'dff-'));
  const cdp = 9477;
  const proc = spawn(EDGE, ['--headless=new', '--disable-gpu', '--no-first-run',
    '--remote-debugging-port=' + cdp, '--user-data-dir=' + profile,
    'about:blank'], { stdio: 'ignore' });

  let v = null;
  for (let i = 0; i < 60; i++) {
    try { v = await (await fetch('http://127.0.0.1:' + cdp + '/json/version')).json(); break; }
    catch (e) { await sleep(250); }
  }
  if (!v) { console.log('CDP 未就绪'); process.exit(1); }

  const list = await (await fetch('http://127.0.0.1:' + cdp + '/json/list')).json();
  const page = list.find(t => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

  let id = 0; const pend = new Map();
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
  const evlAwait = async e => {
    const r = await send('Runtime.evaluate',
      { expression: e, returnByValue: true, awaitPromise: true });
    if (r && r.exceptionDetails) return 'ERR:' + r.exceptionDetails.text;
    return r && r.result ? r.result.value : undefined;
  };

  await send('Runtime.enable'); await send('Page.enable');

  // 必须先打开一个页面，相对 URL 才能解析
  await send('Page.navigate', { url: BASE + '/admin' });
  await sleep(2000);

  // 用接口挑一条真实条目，设好档位和备注
  const code = await evlAwait(`fetch('/api/admin/login',{method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({password:${JSON.stringify(PW)}})}).then(r=>r.json())
    .then(()=>fetch('/api/admin/list').then(r=>r.json()))
    .then(d=>d.items[0].code)`);
  console.log('测试条目:', code);

  const saveRes = await evlAwait(`fetch('/api/admin/save',{method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({code:${JSON.stringify(code)},variant:'满改',priceTier:'70-80',notes:'档位显示测试',price:0})})
    .then(r=>r.json()).then(d=>JSON.stringify(d))`);
  console.log('保存:', saveRes);

  // 打开前台。前端只认 /c/<code> 这种深链，不读 ?q=
  await send('Page.navigate', { url: BASE + '/c/' + encodeURIComponent(code) });
  await sleep(2800);

  const found = await evl(`(() => {
    const card = [...document.querySelectorAll('#grid .card')]
      .find(c => c.dataset.code === ${JSON.stringify(code)});
    if (!card) return 'NOT_FOUND';
    return card.textContent.replace(/\\s+/g, ' ');
  })()`);
  console.log('卡片文本:', String(found).slice(0, 200));

  check('找到目标卡片', found !== 'NOT_FOUND');
  check('显示配装档位「满改」', /满改/.test(String(found)), String(found).slice(0, 80));
  check('显示造价档位「70-80万」', /70-80万/.test(String(found)), String(found).slice(0, 80));
  check('显示备注', /档位显示测试/.test(String(found)), String(found).slice(0, 80));

  // 还原
  await evlAwait(`fetch('/api/admin/save',{method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({code:${JSON.stringify(code)},variant:'',priceTier:'',notes:'',price:0})})
    .then(r=>r.json())`);
  console.log('已还原');

  ws.close(); proc.kill();
  await sleep(300);
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {}

  console.log();
  if (fails.length) { console.log('失败 ' + fails.length + ' 项'); fails.forEach(f => console.log('  -', f)); process.exit(1); }
  console.log('前台档位显示验证通过 ✓');
})();
