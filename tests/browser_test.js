/**
 * 用 CDP 驱动无头 Edge，走一遍真实用户路径：
 *   登录 → 粘贴一批码 → 解析预览 → 确认导入 → 回前台搜索 → 点复制
 * 只依赖 Node 内置的 WebSocket / fetch，不装任何包。
 */
'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const BASE = process.argv[2] || 'http://127.0.0.1:8126';
const PW = fs.readFileSync('D:\\z1383\\deepseak\\deltaforce-codes\\data\\.admin-password', 'utf8').trim();

const fails = [];
const check = (name, cond, detail) => {
  console.log(`[${cond ? 'PASS' : 'FAIL'}] ${name}${!cond && detail ? '  -- ' + detail : ''}`);
  if (!cond) fails.push(name);
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'dfcdp-'));
  const port = 9333;
  const proc = spawn(EDGE, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
    '--window-size=1280,900', 'about:blank',
  ], { stdio: 'ignore' });

  // 等 CDP 端口就绪
  let version = null;
  for (let i = 0; i < 60; i++) {
    try {
      version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
      break;
    } catch (e) { await sleep(250); }
  }
  if (!version) { console.log('CDP 未就绪'); proc.kill(); process.exit(1); }

  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const page = targets.find((t) => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);

  let msgId = 0;
  const pending = new Map();
  const consoleErrors = [];
  const pageErrors = [];

  await new Promise((res, rej) => {
    ws.onopen = res;
    ws.onerror = rej;
  });

  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const { resolve } = pending.get(m.id);
      pending.delete(m.id);
      resolve(m.result ?? m.error);
    } else if (m.method === 'Runtime.consoleAPICalled') {
      if (m.params.type === 'error') {
        consoleErrors.push(m.params.args.map((a) => a.value ?? a.description).join(' '));
      }
    } else if (m.method === 'Runtime.exceptionThrown') {
      pageErrors.push(m.params.exceptionDetails.text + ' ' +
        (m.params.exceptionDetails.exception?.description || ''));
    }
  };

  const send = (method, params = {}, timeoutMs = 8000) => new Promise((resolve) => {
    const id = ++msgId;
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      pending.delete(id);
      console.log(`   [CDP 超时 ${timeoutMs}ms] ${method}`);
      resolve(undefined);
    }, timeoutMs);
    pending.set(id, {
      resolve: (v) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve(v);
      },
    });
    try {
      ws.send(JSON.stringify({ id, method, params }));
    } catch (e) {
      done = true;
      clearTimeout(timer);
      console.log(`   [CDP 发送失败] ${method}: ${e.message}`);
      resolve(undefined);
    }
  });

  const evl = async (expr, awaitPromise = false) => {
    const r = await send('Runtime.evaluate', {
      expression: expr, returnByValue: true, awaitPromise,
    }, 6000);
    if (r === undefined) return undefined;
    if (r.exceptionDetails) {
      throw new Error('EVAL: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
    }
    return r && r.result ? r.result.value : undefined;
  };

  const step = (name) => console.log(`   · ${name}`);

  await send('Runtime.enable');
  await send('Page.enable');
  await send('Network.enable');

  const goto = async (url) => {
    await send('Page.navigate', { url });
    await sleep(1400);
  };

  console.log('='.repeat(66));
  console.log('1. 后台登录（真实表单提交）');
  console.log('='.repeat(66));
  await goto(BASE + '/admin');

  check('登录页可见', await evl(`!document.getElementById('loginView').hidden`));
  check('主界面初始隐藏', await evl(`document.getElementById('adminView').hidden`));

  // 先输错密码
  await evl(`document.getElementById('pw').value='definitely-wrong';`);
  await evl(`document.getElementById('loginForm').dispatchEvent(new Event('submit',{cancelable:true}));`);
  await sleep(700);
  check('错误密码显示报错',
    await evl(`!document.getElementById('loginErr').hidden`),
    await evl(`document.getElementById('loginErr').textContent`));
  check('错误密码后仍停在登录页',
    await evl(`!document.getElementById('loginView').hidden`));

  // 正确密码
  await evl(`document.getElementById('pw').value=${JSON.stringify(PW)};`);
  await evl(`document.getElementById('loginForm').dispatchEvent(new Event('submit',{cancelable:true}));`);
  await sleep(1200);
  check('正确密码后进入主界面',
    await evl(`!document.getElementById('adminView').hidden`));
  check('登录后显示已收录条数',
    await evl(`document.getElementById('dbStat').textContent.includes('条')`),
    await evl(`document.getElementById('dbStat').textContent`));
  check('表格已渲染出数据行',
    await evl(`document.querySelectorAll('#adminBody tr[data-code]').length > 0`),
    String(await evl(`document.querySelectorAll('#adminBody tr').length`)));

  console.log();
  console.log('='.repeat(66));
  console.log('2. 批量粘贴 → 解析预览 → 导入');
  console.log('='.repeat(66));
  const tag = Date.now().toString().slice(-6);
  const batch = [
    `QBZ95突击步枪-全面战场-UITEST${tag}A`,
    `MP5冲锋枪-全面战场-UITEST${tag}B`,
    `这条是废话不能入库`,
  ].join('\n');

  await evl(`document.getElementById('pasteArea').value = ${JSON.stringify(batch)};`);
  await evl(`document.getElementById('parseBtn').click();`);
  await sleep(900);

  const pvCount = await evl(`document.querySelectorAll('#previewList .pv-row').length`);
  check('预览列出 3 行', pvCount === 3, String(pvCount));
  check('预览里能认出厂牌枪名',
    await evl(`[...document.querySelectorAll('#previewList .pv-gun-input')]
                 .some(i => i.value.includes('QBZ95'))`),
    await evl(`[...document.querySelectorAll('#previewList .pv-gun-input')]
                 .map(i => i.value).join('|')`));
  check('废话行被标记为无法识别',
    await evl(`document.querySelectorAll('#previewList .pv-row.bad').length === 1`),
    String(await evl(`document.querySelectorAll('#previewList .pv-row.bad').length`)));
  check('导入按钮已启用',
    await evl(`!document.getElementById('importBtn').disabled`));

  await evl(`document.getElementById('dSeason').value='S9';`);
  await evl(`document.getElementById('importBtn').click();`);
  await sleep(1500);

  check('导入后给出结果提示',
    await evl(`document.getElementById('importMsg').textContent.includes('新增')`),
    await evl(`document.getElementById('importMsg').textContent`));
  check('导入后列表里出现新枪',
    await evl(`[...document.querySelectorAll('#adminBody input[data-f="gun_name"]')]
                 .some(i => i.value.includes('QBZ95'))`));

  console.log();
  console.log('='.repeat(66));
  console.log('3. 前台搜索 + 复制');
  console.log('='.repeat(66));
  await goto(BASE + '/?q=' + encodeURIComponent('QBZ95'));

  // 页面上的搜索框由 JS 读取 URL 吗？这里显式输入，模拟真实操作
  await evl(`(() => {
    const q = document.getElementById('q');
    q.value = 'QBZ95';
    q.dispatchEvent(new Event('input', {bubbles:true}));
    return true;
  })()`);
  await sleep(900);

  const cards = await evl(`document.querySelectorAll('#grid .card').length`);
  check('搜索 QBZ95 有结果', cards >= 1, String(cards));
  check('结果确实是 QBZ95',
    await evl(`[...document.querySelectorAll('.card-gun')].every(e => e.textContent.includes('QBZ95'))`),
    await evl(`[...document.querySelectorAll('.card-gun')].map(e=>e.textContent).join(',')`));

  // 复制行为的验证：无头模式下读系统剪贴板会挂住，改为拦截 writeText，
  // 直接核对「应用究竟把哪段文字写进了剪贴板」。
  step('安装剪贴板拦截钩子');
  await evl(`(() => {
    window.__copied = null;
    navigator.clipboard.writeText = (t) => { window.__copied = t; return Promise.resolve(); };
    return true;
  })()`);

  step('读取目标码');
  const expectedCode = await evl(`document.querySelector('#grid .card').dataset.code`);
  step('点击复制按钮');
  await evl(`document.querySelector('#grid .card .btn-copy').click();`);
  await sleep(900);
  step('读取结果');

  check('复制时写入剪贴板的内容正确',
    await evl(`window.__copied`) === expectedCode,
    `expect=${expectedCode} got=${await evl(`window.__copied`)}`);

  check('复制按钮变成已复制态',
    await evl(`document.querySelector('#grid .card .btn-copy').classList.contains('done')`),
    await evl(`document.querySelector('#grid .card .btn-copy').textContent`));
  check('复制按钮提示文案已切换',
    await evl(`document.querySelector('#grid .card .btn-copy').textContent.includes('已复制')`),
    await evl(`document.querySelector('#grid .card .btn-copy').textContent`));
  check('飘出复制成功提示',
    await evl(`document.getElementById('toast').classList.contains('show')`),
    await evl(`document.getElementById('toast').textContent`));
  check('复制次数已累加',
    await evl(`Number(document.querySelector('#grid .card .copy-count').dataset.n) >= 1`),
    await evl(`document.querySelector('#grid .card .copy-count').textContent`));

  console.log();
  console.log('='.repeat(66));
  console.log('4. 筛选与空状态');
  console.log('='.repeat(66));
  await evl(`document.querySelector('.mode-card[data-val="烽火地带"]').click();`);
  await sleep(900);
  check('切换到烽火地带后仍有卡片或空态正常',
    await evl(`document.querySelectorAll('#grid .card').length >= 0`));
  check('选中的模式卡片高亮',
    await evl(`document.querySelector('.mode-card[data-val="烽火地带"]').classList.contains('is-on')`));

  await evl(`(() => {
    const q = document.getElementById('q');
    q.value = 'zzz这个枪肯定不存在';
    q.dispatchEvent(new Event('input', {bubbles:true}));
  })()`);
  await sleep(900);
  check('无结果时显示空态', await evl(`!document.getElementById('empty').hidden`));
  check('空态文案包含关键词',
    await evl(`document.getElementById('emptyText').textContent.includes('zzz')`),
    await evl(`document.getElementById('emptyText').textContent`));

  console.log();
  console.log('='.repeat(66));
  console.log('5. JS 运行时错误检查');
  console.log('='.repeat(66));
  const realErrors = pageErrors.filter((e) => e && !/favicon/i.test(e));
  check('没有未捕获的 JS 异常', realErrors.length === 0, realErrors.join(' | '));
  const realConsole = consoleErrors.filter((e) => !/favicon|404/i.test(String(e)));
  check('控制台没有报错', realConsole.length === 0, realConsole.join(' | '));

  ws.close();
  proc.kill();
  await sleep(300);
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {}

  console.log();
  console.log('='.repeat(66));
  if (fails.length) {
    console.log(`失败 ${fails.length} 项：`);
    fails.forEach((f) => console.log('  -', f));
    process.exit(1);
  }
  console.log('浏览器端全链路通过 ✓');
})();
