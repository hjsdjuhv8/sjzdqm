/**
 * 验证档位/备注功能：
 *   1. 导入区三个控件存在且可用
 *   2. 行内选中「半改」+ 造价档位 + 备注，保存后真正写入数据库
 *   3. 前台卡片能显示配装档位与造价档位
 */
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
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'dfv-'));
  const cdp = 9466;
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

  await send('Runtime.enable');
  await send('Page.enable');
  await send('Page.navigate', { url: BASE + '/admin' });
  await sleep(1800);
  await evl('document.getElementById("pw").value=' + JSON.stringify(PW) + ';');
  await evl('document.getElementById("loginForm").dispatchEvent(new Event("submit",{cancelable:true}));');
  await sleep(2200);

  console.log('='.repeat(60));
  console.log('1. 导入区控件');
  console.log('='.repeat(60));
  check('配装档位按钮 4 个（含不指定）',
    await evl('document.querySelectorAll("#dVariant .variant-btn").length') === 4);
  check('造价档位下拉含 9 个档 + 不指定',
    await evl('document.querySelectorAll("#dPriceTier option").length') === 10,
    String(await evl('document.querySelectorAll("#dPriceTier option").length')));
  check('备注输入框存在', await evl('!!document.getElementById("dNotes")'));

  const tierLabels = await evl(
    '[...document.querySelectorAll("#dPriceTier option")].map(o=>o.textContent).join("|")');
  console.log('  档位列表:', tierLabels);
  check('包含 20-30万 与 100万以上',
    /20-30万/.test(String(tierLabels)) && /100万以上/.test(String(tierLabels)));

  console.log();
  console.log('='.repeat(60));
  console.log('2. 行内编辑并保存');
  console.log('='.repeat(60));
  const rowCode = await evl('document.querySelector("#adminBody tr[data-code]").dataset.code');
  console.log('  目标条目:', rowCode);

  // 点「半改」
  await evl(`(() => {
    const tr = document.querySelector('#adminBody tr[data-code]');
    const btn = [...tr.querySelectorAll('[data-group="variant"] .variant-btn')]
                  .find(b => b.dataset.val === '半改');
    btn.click();
    return true;
  })()`);

  // 选造价档位 50-60
  await evl(`(() => {
    const tr = document.querySelector('#adminBody tr[data-code]');
    const sel = tr.querySelector('[data-f="price_tier"]');
    sel.value = '50-60';
    sel.dispatchEvent(new Event('change', {bubbles:true}));
    return sel.value;
  })()`);

  // 写备注
  await evl(`(() => {
    const tr = document.querySelector('#adminBody tr[data-code]');
    const inp = tr.querySelector('[data-f="notes"]');
    inp.value = '自动测试备注';
    inp.dispatchEvent(new Event('input', {bubbles:true}));
    return inp.value;
  })()`);

  // 保存
  await evl(`document.querySelector('#adminBody tr[data-code] .mini-btn.save').click()`);
  await sleep(1500);

  // 从后端核对
  const saved = await evlAwait(`fetch('/api/admin/list').then(r=>r.json()).then(d=>{
    const it = d.items.find(x=>x.code===${JSON.stringify(rowCode)});
    return it ? JSON.stringify({v:it.variant,t:it.price_tier,n:it.notes,p:it.price}) : 'null';
  })`);
  console.log('  保存结果:', saved);
  let obj = {};
  try { obj = JSON.parse(saved); } catch (e) {}
  check('配装档位存为「半改」', obj.v === '半改', String(obj.v));
  check('造价档位存为 50-60', obj.t === '50-60', String(obj.t));
  check('备注已保存', obj.n === '自动测试备注', String(obj.n));
  check('价格按档位下限填充 500000', obj.p === 500000, String(obj.p));

  console.log();
  console.log('='.repeat(60));
  console.log('3. 前台显示档位');
  console.log('='.repeat(60));
  // 前端只认 /c/<code> 深链；而且必须按 code 精确定位卡片
  await send('Page.navigate', { url: BASE + '/c/' + encodeURIComponent(rowCode) });
  await sleep(2800);
  const cardText = await evl(`(() => {
    const card = [...document.querySelectorAll('#grid .card')]
      .find(c => c.dataset.code === ${JSON.stringify(rowCode)});
    return card ? card.textContent.replace(/\\s+/g,' ') : 'NOT_FOUND';
  })()`);
  console.log('  卡片文本:', String(cardText).slice(0, 160));
  check('卡片显示配装档位「半改」', /半改/.test(String(cardText)));
  check('卡片显示造价档位「50-60万」', /50-60万/.test(String(cardText)));
  check('卡片显示备注', /自动测试备注/.test(String(cardText)));

  console.log();
  console.log('='.repeat(60));
  console.log('4. 还原测试数据');
  console.log('='.repeat(60));
  await evlAwait(`fetch('/api/admin/save',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({code:${JSON.stringify(rowCode)},variant:'',priceTier:'',notes:'',price:0})})
    .then(r=>r.json()).then(d=>d.ok?'restored':'fail')`);
  console.log('  已还原');

  ws.close(); proc.kill();
  await sleep(300);
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {}

  console.log();
  console.log('='.repeat(60));
  if (fails.length) { console.log('失败 ' + fails.length + ' 项'); fails.forEach(f => console.log('  -', f)); process.exit(1); }
  console.log('档位与备注功能验证通过 ✓');
})();
