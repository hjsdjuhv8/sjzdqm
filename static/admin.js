/* ==========================================================================
   后台交互 —— 登录 / 批量粘贴解析 / 逐条编辑 / 删除
   ========================================================================== */
(function () {
  'use strict';

  var CATS = ['步枪', '冲锋枪', '霰弹枪', '轻机枪', '精确射手步枪',
              '狙击步枪', '手枪', '特殊武器', '其他'];
  var MODES = ['烽火地带', '全面战场', '黑潮爆破'];
  var VARIANTS = ['丐版', '半改', '满改'];

  // 造价档位。后端也会返回一份，这里保留兜底，离线也能用。
  var PRICE_TIERS = [
    { value: '20-30', label: '20-30万', min: 200000 },
    { value: '30-40', label: '30-40万', min: 300000 },
    { value: '40-50', label: '40-50万', min: 400000 },
    { value: '50-60', label: '50-60万', min: 500000 },
    { value: '60-70', label: '60-70万', min: 600000 },
    { value: '70-80', label: '70-80万', min: 700000 },
    { value: '80-90', label: '80-90万', min: 800000 },
    { value: '90-100', label: '90-100万', min: 900000 },
    { value: '100+', label: '100万以上', min: 1000000 }
  ];

  var dVariant = '';       // 导入时套用的配装档位
  var priceTiers = PRICE_TIERS.slice();

  var previewRows = [];
  var adminRows = [];

  var el = {
    loginView: document.getElementById('loginView'),
    adminView: document.getElementById('adminView'),
    loginForm: document.getElementById('loginForm'),
    pw: document.getElementById('pw'),
    loginErr: document.getElementById('loginErr'),
    dbStat: document.getElementById('dbStat'),
    logoutBtn: document.getElementById('logoutBtn'),
    pasteArea: document.getElementById('pasteArea'),
    dMode: document.getElementById('dMode'),
    dCategory: document.getElementById('dCategory'),
    dSeason: document.getElementById('dSeason'),
    dCommit: document.getElementById('dCommit'),
    dVariant: document.getElementById('dVariant'),
    dPriceTier: document.getElementById('dPriceTier'),
    dNotes: document.getElementById('dNotes'),
    parseBtn: document.getElementById('parseBtn'),
    importBtn: document.getElementById('importBtn'),
    clearBtn: document.getElementById('clearBtn'),
    importMsg: document.getElementById('importMsg'),
    previewTitle: document.getElementById('previewTitle'),
    previewList: document.getElementById('previewList'),
    fillGunBtn: document.getElementById('fillGunBtn'),
    adminBody: document.getElementById('adminBody'),
    searchAdmin: document.getElementById('searchAdmin'),
    adminCount: document.getElementById('adminCount'),
    toast: document.getElementById('toast')
  };

  /* ------------------------------------------------------------ 工具 */

  var toastTimer = null;
  function toast(msg, isErr) {
    el.toast.textContent = msg;
    el.toast.className = 'toast show' + (isErr ? ' err' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.toast.className = 'toast'; }, 2400);
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  /* 价格统一用「万」显示与录入。
     数据库里存的是原始游戏币（940000），
     界面显示 94，保存时再乘 10000 还原。
     兼容：如果用户直接输 940000 这种完整数字，也能正确识别。 */
  function fmtPrice(v) {
    var n = Number(v) || 0;
    if (n <= 0) return '';
    if (n >= 10000) {
      var w = n / 10000;
      var s = w.toFixed(w % 1 === 0 ? 0 : 1);
      return s;
    }
    return String(n);
  }

  // 把用户输入的「万」换算回原始值
  function parsePrice(s) {
    var t = String(s == null ? '' : s).trim();
    if (!t) return 0;
    t = t.replace(/[,\s]/g, '').replace(/万$/, '');
    var n = parseFloat(t);
    if (!isFinite(n) || n <= 0) return 0;
    // 小于 1000 视为「万」单位（940 → 940万 这个量级不可能，所以 94 就是 94万）
    return n < 1000 ? Math.round(n * 10000) : Math.round(n);
  }

  // 当前访问的主机，用于「服务连不上」时给出准确提示
  var BASE_HINT = location.host || '127.0.0.1:8000';

  function api(path, opts) {
    opts = opts || {};
    opts.headers = Object.assign(
      { 'Content-Type': 'application/json' }, opts.headers || {});
    return fetch(path, opts).then(function (r) {
      return r.json().catch(function () { return { ok: false, error: 'HTTP ' + r.status }; })
        .then(function (data) {
          if (r.status === 401 && !opts.noAuthRedirect) {
            // 会话过期：切回登录页，并让调用方知道「不是业务失败」
            showLogin();
            var err = new Error(data && data.error ? data.error : '登录已过期，请重新登录');
            err.code = 401;
            throw err;
          }
          return data;
        });
    }, function () {
      // fetch 本身失败 = 服务没起来 / 端口不对 / 网络断。
      // 这和「解析失败」是两回事，必须分开报，否则用户根本查不出原因。
      var err = new Error('无法连接后台服务（' + BASE_HINT + '）。' +
                          '请确认 start.bat 的窗口还开着。');
      err.code = 'NETWORK';
      throw err;
    });
  }

  /* ------------------------------------------------------------ 登录 */

  function showLogin() {
    el.loginView.hidden = false;
    el.adminView.hidden = true;
  }

  function showAdmin() {
    el.loginView.hidden = true;
    el.adminView.hidden = false;
    loadAdminList();
  }

  el.loginForm.addEventListener('submit', function (e) {
    e.preventDefault();
    el.loginErr.hidden = true;
    api('/api/admin/login', {
      method: 'POST',
      body: JSON.stringify({ password: el.pw.value })
    }).then(function (d) {
      if (d.ok) {
        el.pw.value = '';
        showAdmin();
      } else {
        el.loginErr.textContent = d.error || '登录失败';
        el.loginErr.hidden = false;
      }
    }).catch(function (e) {
      el.loginErr.textContent = (e && e.code === 'NETWORK')
        ? e.message
        : '网络错误';
      el.loginErr.hidden = false;
    });
  });

  el.logoutBtn.addEventListener('click', function () {
    api('/api/admin/logout', { method: 'POST', body: '{}' }).finally(showLogin);
  });

  /* ------------------------------------------------------------ 解析预览 */

  function defaults() {
    return {
      mode: el.dMode.value,
      category: el.dCategory.value,
      season: el.dSeason.value.trim(),
      variant: dVariant,
      priceTier: el.dPriceTier ? el.dPriceTier.value : ''
    };
  }

  /* 配装档位：三选一按钮 */
  function bindVariantPicker() {
    if (!el.dVariant) return;
    el.dVariant.addEventListener('click', function (e) {
      var btn = e.target.closest('.variant-btn');
      if (!btn) return;
      dVariant = btn.dataset.val || '';
      Array.prototype.forEach.call(
        el.dVariant.querySelectorAll('.variant-btn'),
        function (b) { b.classList.toggle('on', b === btn); });
    });
  }

  /* 造价档位下拉 */
  function fillPriceTiers(tiers) {
    if (!el.dPriceTier) return;
    var list = (tiers && tiers.length) ? tiers : PRICE_TIERS;
    priceTiers = list;
    var html = '<option value="">不指定</option>';
    list.forEach(function (t) {
      html += '<option value="' + esc(t.value) + '">' + esc(t.label) + '</option>';
    });
    el.dPriceTier.innerHTML = html;
  }

  function tierLabel(v) {
    for (var i = 0; i < priceTiers.length; i++) {
      if (priceTiers[i].value === v) return priceTiers[i].label;
    }
    return '';
  }

  function renderPreview(items) {
    previewRows = items;
    if (!items.length) {
      el.previewList.innerHTML =
        '<p class="preview-empty">没有识别到任何内容，检查一下粘贴的内容。</p>';
      el.previewTitle.textContent = '解析结果';
      el.importBtn.disabled = true;
      el.fillGunBtn.hidden = true;
      return;
    }

    var okN = items.filter(function (i) { return i.ok; }).length;
    var needGun = items.filter(function (i) { return i.code && !i.gunName; }).length;
    el.previewTitle.textContent =
      '解析结果：' + items.length + ' 行，可入库 ' + (okN + needGun) + ' 条';

    var html = items.map(function (it, i) {
      var bad = !it.code;
      var cls = 'pv-row' + (bad ? ' bad' : '');
      var badge = '';
      if (bad) badge = '<span class="pv-badge err">' + esc(it.reason || '无法识别') + '</span>';
      else if (!it.gunName) badge = '<span class="pv-badge err">缺枪名 · 可手填</span>';
      else if (it.duplicate) badge = '<span class="pv-badge dup">重复 · 将覆盖更新</span>';
      else badge = '<span class="pv-badge">' + esc(it.mode || '未定模式') + '</span>';

      var gunCell = it.code
        ? '<input data-i="' + i + '" class="pv-gun-input" value="' + esc(it.gunName || '') +
          '" placeholder="填入枪名，如 腾龙突击步枪">'
        : '<span class="pv-code">' + esc(it.input || '') + '</span>';

      return '<div class="' + cls + '">' +
               '<div class="pv-gun">' + gunCell + '</div>' +
               badge +
               (it.code ? '<div class="pv-code">' + esc(it.code) + '</div>' : '') +
             '</div>';
    }).join('');

    el.previewList.innerHTML = html;
    el.importBtn.disabled = false;
    el.fillGunBtn.hidden = needGun === 0;

    // 手动补枪名
    Array.prototype.forEach.call(
      el.previewList.querySelectorAll('.pv-gun-input'),
      function (inp) {
        inp.addEventListener('input', function () {
          var i = Number(inp.dataset.i);
          if (previewRows[i]) {
            previewRows[i].gunName = inp.value.trim();
            previewRows[i].ok = !!previewRows[i].gunName;
          }
        });
      });
  }

  el.parseBtn.addEventListener('click', function () {
    var text = el.pasteArea.value;
    if (!text.trim()) { toast('先粘贴点内容', true); return; }
    el.parseBtn.disabled = true;
    api('/api/admin/parse', {
      method: 'POST', body: JSON.stringify({ text: text })
    }).then(function (d) {
      el.parseBtn.disabled = false;
      if (!d.ok) { toast(d.error || '解析失败', true); return; }
      renderPreview(d.items || []);
      var bad = (d.items || []).filter(function (i) { return !i.code; }).length;
      el.importMsg.textContent = bad
        ? '有 ' + bad + ' 行没识别出码，可忽略或手动处理'
        : '全部识别成功';
      el.importMsg.className = 'micro' + (bad ? ' warn' : '');
    }).catch(function (e) {
      el.parseBtn.disabled = false;
      if (e && e.code === 401) {
        toast('登录已过期，请重新登录后再解析', true);
      } else if (e && e.code === 'NETWORK') {
        toast(e.message, true);
      } else {
        toast('解析失败：' + (e && e.message ? e.message : '网络异常'), true);
      }
    });
  });

  // 把枪名批量填到所有缺枪名的行上（一次贴一个枪的所有改枪码时很省事）
  el.fillGunBtn.addEventListener('click', function () {
    var name = window.prompt('把这些缺枪名的条目统一填成哪把枪？');
    if (!name) return;
    name = name.trim();
    previewRows.forEach(function (it) {
      if (it.code && !it.gunName) { it.gunName = name; it.ok = true; }
    });
    renderPreview(previewRows);
    toast('已填充');
  });

  el.clearBtn.addEventListener('click', function () {
    el.pasteArea.value = '';
    el.importMsg.textContent = '';
    el.previewList.innerHTML =
      '<p class="preview-empty">粘贴后点「解析预览」，这里会列出识别到的每一把枪。</p>';
    el.previewTitle.textContent = '解析结果';
    el.importBtn.disabled = true;
    el.fillGunBtn.hidden = true;
    previewRows = [];
  });

  /* ------------------------------------------------------------ 导入 */

  el.importBtn.addEventListener('click', function () {
    var rows = previewRows.filter(function (it) { return it.code && it.gunName; });
    if (!rows.length) { toast('没有可导入的条目', true); return; }
    var missing = previewRows.filter(function (it) { return it.code && !it.gunName; }).length;
    if (missing > 0) {
      toast('还有 ' + missing + ' 条缺枪名，已跳过', true);
    }

    var payload = {
      rows: rows.map(function (it) {
        return {
          code: it.code, gunName: it.gunName, mode: it.mode || '',
          category: '', season: defaults().season,
          tags: '', notes: (el.dNotes ? el.dNotes.value.trim() : ''),
          price: 0, videoUrl: '',
          variant: dVariant,
          priceTier: (el.dPriceTier ? el.dPriceTier.value : '')
        };
      }),
      defaults: defaults()
    };

    el.importBtn.disabled = true;
    el.importBtn.textContent = '导入中…';
    api('/api/admin/import', {
      method: 'POST', body: JSON.stringify(payload)
    }).then(function (d) {
      el.importBtn.disabled = false;
      el.importBtn.textContent = '确认导入';
      if (!d.ok) { toast(d.error || '导入失败', true); return; }
      toast('新增 ' + d.inserted + ' 条，更新 ' + d.updated + ' 条');
      el.importMsg.textContent = '新增 ' + d.inserted + ' 条，更新 ' + d.updated + ' 条';
      el.importMsg.className = 'micro';
      loadAdminList();
      // 导入后清空预览，避免重复点
      previewRows = [];
      el.previewList.innerHTML =
        '<p class="preview-empty">导入完成。要再贴一批，直接重新粘贴即可。</p>';
      el.previewTitle.textContent = '解析结果';
      el.importBtn.disabled = true;
      el.fillGunBtn.hidden = true;
      el.pasteArea.value = '';
    }).catch(function (e) {
      el.importBtn.disabled = false;
      el.importBtn.textContent = '确认导入';
      if (e && e.code === 401) {
        toast('登录已过期，请重新登录后再导入', true);
      } else if (e && e.code === 'NETWORK') {
        toast(e.message, true);
      } else {
        toast('导入失败：' + (e && e.message ? e.message : '网络异常'), true);
      }
    });
  });

  /* ------------------------------------------------------------ 列表 */

  function loadAdminList() {
    var q = el.searchAdmin.value.trim();
    api('/api/admin/list?q=' + encodeURIComponent(q) + '&_=' + Date.now())
      .then(function (d) {
        if (!d.ok) { toast(d.error || '加载失败', true); return; }
        adminRows = d.items || [];
        renderAdminTable();
      }).catch(function () {});
  }

  function renderAdminTable() {
    el.adminCount.textContent = adminRows.length + ' 条';
    el.dbStat.textContent = '当前收录 ' + adminRows.length + ' 条';

    if (!adminRows.length) {
      el.adminBody.innerHTML =
        '<tr><td colspan="10" style="text-align:center;color:var(--txt-faint);padding:26px">' +
        '还没有数据，先在上面粘贴导入一批</td></tr>';
      return;
    }

    el.adminBody.innerHTML = adminRows.map(function (r) {
      var catOpts = CATS.map(function (c) {
        return '<option' + (c === r.category ? ' selected' : '') + '>' + c + '</option>';
      }).join('');
      var modeOpts = ['<option value="">—</option>'].concat(MODES.map(function (m) {
        return '<option' + (m === r.mode ? ' selected' : '') + '>' + m + '</option>';
      })).join('');

      // 配装档位：三选一，用按钮组而不是下拉，点起来更快
      var variantBtns = VARIANTS.map(function (v) {
        var on = (r.variant === v) ? ' on' : '';
        return '<button type="button" class="variant-btn sm' + on +
               '" data-f="variant" data-val="' + esc(v) + '">' + esc(v) + '</button>';
      }).join('');

      // 造价档位下拉
      var tierOpts = '<option value="">—</option>' + priceTiers.map(function (t) {
        var sel = (r.price_tier === t.value) ? ' selected' : '';
        return '<option value="' + esc(t.value) + '"' + sel + '>' +
               esc(t.label) + '</option>';
      }).join('');

      return '<tr data-code="' + esc(r.code) + '">' +
        '<td><input data-f="gun_name" value="' + esc(r.gun_name) + '"></td>' +
        '<td><select data-f="category">' + catOpts + '</select></td>' +
        '<td><select data-f="mode">' + modeOpts + '</select></td>' +
        '<td><input data-f="season" value="' + esc(r.season) + '" maxlength="12"></td>' +
        '<td><div class="variant-picker sm" data-group="variant">' + variantBtns + '</div></td>' +
        '<td><select data-f="price_tier">' + tierOpts + '</select></td>' +
        '<td><input data-f="notes" value="' + esc(r.notes) + '" placeholder="提示文字"></td>' +
        '<td class="cell-code" title="' + esc(r.code) + '">' + esc(r.code) + '</td>' +
        '<td class="cell-num">' + (r.copied || 0) + '</td>' +
        '<td><select data-f="status">' +
          '<option value="published"' + (r.status === 'published' ? ' selected' : '') + '>上架</option>' +
          '<option value="draft"' + (r.status === 'draft' ? ' selected' : '') + '>草稿</option>' +
        '</select></td>' +
        '<td><div class="row-actions">' +
          '<button class="mini-btn save" type="button">保存</button>' +
          '<button class="mini-btn del" type="button">删除</button>' +
        '</div></td>' +
      '</tr>';
    }).join('');

    Array.prototype.forEach.call(el.adminBody.querySelectorAll('tr'), wireRow);
  }

  function wireRow(tr) {
    var inputs = tr.querySelectorAll('[data-f]');
    Array.prototype.forEach.call(inputs, function (inp) {
      if (inp.tagName === 'BUTTON') return;   // 按钮组单独处理
      inp.addEventListener('input', function () { tr.classList.add('dirty'); });
      inp.addEventListener('change', function () { tr.classList.add('dirty'); });
    });

    // 行内的配装档位按钮组：点一下选中，再点同一取消
    Array.prototype.forEach.call(
      tr.querySelectorAll('[data-group="variant"]'),
      function (group) {
        group.addEventListener('click', function (e) {
          var btn = e.target.closest('.variant-btn');
          if (!btn) return;
          var wasOn = btn.classList.contains('on');
          Array.prototype.forEach.call(
            group.querySelectorAll('.variant-btn'),
            function (b) { b.classList.remove('on'); });
          if (!wasOn) btn.classList.add('on');
          tr.classList.add('dirty');
        });
      });

    tr.querySelector('.mini-btn.save').addEventListener('click', function () {
      var code = tr.dataset.code;
      var payload = { code: code };

      Array.prototype.forEach.call(inputs, function (inp) {
        if (inp.tagName === 'BUTTON') return;
        if (inp.dataset.f === 'price_tier') {
          payload.priceTier = inp.value;
        } else {
          payload[camel(inp.dataset.f)] = inp.value;
        }
      });

      // 收集本行选中的配装档位
      var onBtn = tr.querySelector('[data-group="variant"] .variant-btn.on');
      payload.variant = onBtn ? onBtn.dataset.val : '';

      api('/api/admin/save', {
        method: 'POST', body: JSON.stringify(payload)
      }).then(function (d) {
        if (!d.ok) { toast(d.error || '保存失败', true); return; }
        tr.classList.remove('dirty');
        toast('已保存');
      }).catch(function () {});
    });

    tr.querySelector('.mini-btn.del').addEventListener('click', function () {
      var code = tr.dataset.code;
      if (!window.confirm('确定删除这条改枪码？\n' + code)) return;
      api('/api/admin/delete', {
        method: 'POST', body: JSON.stringify({ code: code })
      }).then(function (d) {
        if (!d.ok) { toast(d.error || '删除失败', true); return; }
        tr.remove();
        adminRows = adminRows.filter(function (r) { return r.code !== code; });
        el.adminCount.textContent = adminRows.length + ' 条';
        toast('已删除');
      }).catch(function () {});
    });
  }

  function camel(s) {
    return s.replace(/_([a-z])/g, function (_, c) { return c.toUpperCase(); });
  }

  var searchTimer = null;
  el.searchAdmin.addEventListener('input', function () {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(loadAdminList, 250);
  });

  /* ------------------------------------------------------------ 启动 */

  bindVariantPicker();
  fillPriceTiers(PRICE_TIERS);

  // 从后端拿档位定义（保证前后端一致）
  fetch('/api/meta').then(function (r) { return r.json(); }).then(function (d) {
    if (d && d.ok && d.priceTiers && d.priceTiers.length) {
      fillPriceTiers(d.priceTiers);
    }
  }).catch(function () {});

  api('/api/admin/session', { noAuthRedirect: true }).then(function (d) {
    if (d && d.loggedIn) showAdmin();
    else showLogin();
  }).catch(function () { showLogin(); });
})();
