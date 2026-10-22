/* ==========================================================================
   三角洲行动 · 改枪码库  —— 前台交互
   无框架、无构建，直接由 server.py 静态托管。
   ========================================================================== */
(function () {
  'use strict';

  var PAGE_SIZE = 24;

  var state = {
    q: '', mode: '', category: '', season: '', sort: 'hot',
    offset: 0, total: 0, loading: false, items: []
  };

  var el = {
    q: document.getElementById('q'),
    qClear: document.getElementById('qClear'),
    modeFilter: document.getElementById('modeFilter'),
    catFilter: document.getElementById('catFilter'),
    sort: document.getElementById('sort'),
    season: document.getElementById('season'),
    grid: document.getElementById('grid'),
    empty: document.getElementById('empty'),
    emptyText: document.getElementById('emptyText'),
    resetBtn: document.getElementById('resetBtn'),
    resultCount: document.getElementById('resultCount'),
    activeHint: document.getElementById('activeHint'),
    loadMoreWrap: document.getElementById('loadMoreWrap'),
    loadMore: document.getElementById('loadMore'),
    metaLine: document.getElementById('metaLine'),
    toast: document.getElementById('toast')
  };

  var toastTimer = null;
  function toast(msg, isErr) {
    el.toast.textContent = msg;
    el.toast.className = 'toast show' + (isErr ? ' err' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      el.toast.className = 'toast';
    }, 2200);
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function money(n) {
    n = Number(n) || 0;
    if (n <= 0) return '';
    if (n >= 10000) return (n / 10000).toFixed(n % 10000 === 0 ? 0 : 1) + '万';
    return String(n);
  }

  /* ---------------------------------------------------------- 复制 ---------- */

  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text);
    }
    // http 部署或旧浏览器走兜底方案
    return new Promise(function (resolve, reject) {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:fixed;top:-1000px;left:-1000px;opacity:0';
      document.body.appendChild(ta);
      ta.select();
      ta.setSelectionRange(0, text.length);
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      document.body.removeChild(ta);
      ok ? resolve() : reject(new Error('copy failed'));
    });
  }

  function reportCopy(code) {
    // 计数失败不影响用户，静默处理。
    // 静态托管（对象存储 / Pages）没有后端，这个请求 404 属于正常情况。
    if (STATIC_MODE) return;
    fetch('/api/copy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: code }),
      keepalive: true
    }).catch(function () {});
  }

  function onCopyClick(btn, card, code) {
    copyText(code).then(function () {
      btn.classList.add('done');
      btn.textContent = '✓ 已复制，去游戏里粘贴';
      card.classList.add('is-copied');
      var c = card.querySelector('.copy-count');
      if (c) c.textContent = (Number(c.dataset.n || 0) + 1) + ' 次复制';
      if (c) c.dataset.n = Number(c.dataset.n || 0) + 1;
      reportCopy(code);
      toast('已复制：' + code);
      setTimeout(function () {
        btn.classList.remove('done');
        btn.textContent = '复制改枪码';
        card.classList.remove('is-copied');
      }, 2600);
    }).catch(function () {
      // 最终兜底：选中文本让用户手动复制
      toast('自动复制被浏览器拦截，请长按下方码手动复制', true);
      window.prompt('请手动复制这段改枪码（Ctrl+C）', code);
    });
  }

  /* ---------------------------------------------------------- 渲染 ---------- */

  function cardHTML(it) {
    var meta = [];
    if (it.price > 0) meta.push('<span>造价 ' + esc(money(it.price)) + '</span>');
    if (it.season) meta.push('<span>' + esc(it.season) + '</span>');
    if (it.category) meta.push('<span>' + esc(it.category) + '</span>');
    var modeBadge = it.mode
      ? '<span class="badge badge-mode-' + esc(it.mode) + '">' + esc(it.mode) + '</span>'
      : '';

    var tags = (it.tags || '').split(/[,，\s]+/).filter(Boolean).slice(0, 6)
      .map(function (t) { return '<span class="tag">' + esc(t) + '</span>'; }).join('');

    var note = it.notes ? '<p class="card-note">' + esc(it.notes) + '</p>' : '';

    return '' +
      '<article class="card" data-code="' + esc(it.code) + '">' +
        '<div class="card-head">' +
          '<h2 class="card-gun">' + esc(it.gun_name || '未命名') + '</h2>' +
          modeBadge +
        '</div>' +
        (meta.length ? '<div class="card-meta">' + meta.map(function (m, i) {
          return (i ? '<i></i>' : '') + m;
        }).join('') + '</div>' : '') +
        '<div class="code-line"><code title="' + esc(it.code) + '">' + esc(it.code) + '</code></div>' +
        note +
        (tags ? '<div class="tags">' + tags + '</div>' : '') +
        '<div class="card-foot">' +
          '<button class="btn btn-copy" type="button">复制改枪码</button>' +
          '<span class="copy-count" data-n="' + (it.copied || 0) + '">' +
            (it.copied || 0) + ' 次复制</span>' +
        '</div>' +
      '</article>';
  }

  function skeleton(n) {
    var h = '';
    for (var i = 0; i < n; i++) h += '<div class="skeleton"></div>';
    return h;
  }

  function renderAppend(items) {
    el.grid.insertAdjacentHTML('beforeend',
      items.map(cardHTML).join(''));
  }

  function updateResultBar() {
    if (state.loading && state.total === 0) {
      el.resultCount.textContent = '搜索中…';
      return;
    }
    var shown = el.grid.querySelectorAll('.card').length;
    var txt = '共 <b>' + state.total + '</b> 条改枪码';
    if (state.total > shown) txt += '，已显示 ' + shown + ' 条';
    el.resultCount.innerHTML = txt;

    var hints = [];
    if (state.q) hints.push('关键词「' + state.q + '」');
    if (state.mode) hints.push(state.mode);
    if (state.category) hints.push(state.category);
    el.activeHint.textContent = hints.length ? '· ' + hints.join(' · ') : '';

    el.empty.hidden = !(state.total === 0 && !state.loading);
    el.loadMoreWrap.hidden = state.total <= shown;
  }

  /* ---------------------------------------------------------- 取数 ---------- */

  var reqSeq = 0;

  /* ------------------------------------------------------- 数据源适配 ------
   * 同一份前端代码，两种跑法：
   *   - 有后端（server.py）：走 /api/codes、/api/meta
   *   - 纯静态托管（只传了 static/ 到对象存储/Pages）：读 codes.json
   * 判断方式：window.DF_STATIC === true 时（由 index.html 里的注释开关）
   * 或者首次探测 /api/meta 失败，自动降级到静态模式。
   */
  var STATIC_MODE = window.DF_STATIC === true;
  var staticCache = null;      // 静态模式下的全量数据

  function loadStaticData() {
    if (staticCache) return Promise.resolve(staticCache);
    return fetch('codes.json', { cache: 'no-cache' })
      .then(function (r) {
        if (!r.ok) throw new Error('codes.json ' + r.status);
        return r.json();
      })
      .then(function (d) {
        staticCache = d;
        return d;
      });
  }

  // 静态模式下在前端做和服务器一致的过滤/排序/分页
  function filterStatic(data, q, mode, category, season, sort, limit, offset) {
    var items = (data.items || []).slice();
    var ql = (q || '').toLowerCase();

    if (ql) {
      items = items.filter(function (i) {
        return [i.gun_name, i.tags, i.notes, i.code, i.category]
          .some(function (f) { return String(f || '').toLowerCase().indexOf(ql) >= 0; });
      });
    }
    if (mode) items = items.filter(function (i) { return i.mode === mode; });
    if (category) items = items.filter(function (i) { return i.category === category; });
    if (season) items = items.filter(function (i) { return i.season === season; });

    var cmp = {
      hot: function (a, b) { return (b.copied || 0) - (a.copied || 0); },
      new: function (a, b) { return (b.id || 0) - (a.id || 0); },
      name: function (a, b) {
        return String(a.gun_name).localeCompare(String(b.gun_name), 'zh') ||
               (b.copied || 0) - (a.copied || 0);
      },
      price: function (a, b) { return (a.price || 0) - (b.price || 0) || (b.copied || 0) - (a.copied || 0); }
    }[sort] || null;
    if (cmp) items.sort(cmp);

    return {
      total: items.length,
      items: items.slice(offset, offset + limit)
    };
  }

  function fetchPageStatic(reset) {
    // 必须和 HTTP 分支一致：reset 时把 offset 归零，
    // 否则第二次搜索会从上一次的 offset 开始切片，结果被切成空数组。
    if (reset) state.offset = 0;
    loadStaticData().then(function (data) {
      if (reset) el.grid.innerHTML = '';
      var res = filterStatic(data, state.q, state.mode, state.category, state.season,
                             state.sort, PAGE_SIZE, state.offset);
      state.loading = false;
      el.loadMore.disabled = false;
      state.total = res.total;
      if (reset) state.items = res.items;
      else state.items = state.items.concat(res.items);
      state.offset += res.items.length;

      renderAppend(res.items);
      if (state.total === 0) {
        el.grid.innerHTML = '';
        el.emptyText.textContent = state.q
          ? '没有找到「' + state.q + '」，换个关键词试试'
          : '这个筛选条件下还没有改枪码';
      }
      updateResultBar();
    }).catch(function () {
      state.loading = false;
      el.grid.innerHTML = '';
      el.emptyText.textContent = '数据加载失败，请刷新重试';
      toast('数据加载失败', true);
      updateResultBar();
    });
  }

  function fetchPage(reset) {
    if (STATIC_MODE) return fetchPageStatic(reset);
    if (state.loading) return;
    state.loading = true;
    if (reset) {
      state.offset = 0;
      el.grid.innerHTML = skeleton(PAGE_SIZE > 8 ? 8 : PAGE_SIZE);
      el.empty.hidden = true;
      el.loadMoreWrap.hidden = true;
    }
    el.loadMore.disabled = true;

    var seq = ++reqSeq;
    var qs = new URLSearchParams({
      q: state.q, mode: state.mode, category: state.category,
      season: state.season, sort: state.sort,
      limit: String(PAGE_SIZE), offset: String(state.offset)
    });

    fetch('/api/codes?' + qs.toString(), { headers: { 'Accept': 'application/json' } })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (seq !== reqSeq) return;           // 竞态：丢弃过期响应
        state.loading = false;
        el.loadMore.disabled = false;

        if (!data.ok) {
          el.grid.innerHTML = '';
          toast(data.error || '加载失败', true);
          updateResultBar();
          return;
        }
        state.total = data.total || 0;
        state.items = reset ? (data.items || []) : state.items.concat(data.items || []);
        state.offset += (data.items || []).length;

        if (reset) el.grid.innerHTML = '';
        renderAppend(data.items || []);
        if (state.total === 0) {
          el.grid.innerHTML = '';
          el.emptyText.textContent = state.q
            ? '没有找到「' + state.q + '」，换个关键词试试'
            : '这个筛选条件下还没有改枪码';
        }
        updateResultBar();
      })
      .catch(function () {
        if (seq !== reqSeq) return;
        state.loading = false;
        el.loadMore.disabled = false;
        el.grid.innerHTML = '';
        toast('网络异常，请稍后重试', true);
        updateResultBar();
      });
  }

  /* ---------------------------------------------------------- 筛选 UI ------- */

  function buildChips(host, values, key, allLabel) {
    var html = '<button class="chip' + (state[key] === '' ? ' on' : '') +
               '" data-val="">' + allLabel + '</button>';
    values.forEach(function (v) {
      html += '<button class="chip' + (state[key] === v ? ' on' : '') +
              '" data-val="' + esc(v) + '">' + esc(v) + '</button>';
    });
    host.insertAdjacentHTML('beforeend', html);
    host.addEventListener('click', function (e) {
      var btn = e.target.closest('.chip');
      if (!btn) return;
      state[key] = btn.dataset.val || '';
      Array.prototype.forEach.call(host.querySelectorAll('.chip'), function (c) {
        c.classList.toggle('on', c === btn);
      });
      fetchPage(true);
    });
  }

  function applyMeta(d) {
    el.metaLine.innerHTML = '已收录 <b>' + d.total + '</b> 条改枪码';

    var modes = d.modes || [];
    if (modes.length) buildChips(el.modeFilter, modes, 'mode', '全部');

    var cats = d.categories || [];
    if (cats.length) {
      // 只显示库里真实存在的类型，避免一排空按钮
      var present = {};
      (d.guns || []).forEach(function (g) {
        cats.forEach(function (c) { if (g && g.indexOf(c) >= 0) present[c] = 1; });
      });
      var list = cats.filter(function (c) { return present[c]; });
      buildChips(el.catFilter, list.length ? list : cats, 'category', '全部');
    }

    if (d.seasons && d.seasons.length) {
      var opt = '<option value="">全部赛季</option>';
      d.seasons.forEach(function (s) {
        opt += '<option value="' + esc(s) + '">' + esc(s) + '</option>';
      });
      el.season.innerHTML = opt;
      el.season.hidden = false;
      el.season.addEventListener('change', function () {
        state.season = el.season.value;
        fetchPage(true);
      });
    }
  }

  function loadMetaStatic() {
    loadStaticData().then(function (data) {
      var items = data.items || [];
      var modes = {}, cats = {}, seasons = {}, guns = {};
      items.forEach(function (i) {
        if (i.mode) modes[i.mode] = 1;
        if (i.category) cats[i.category] = 1;
        if (i.season) seasons[i.season] = 1;
        if (i.gun_name) guns[i.gun_name] = 1;
      });
      applyMeta({
        total: items.length,
        modes: Object.keys(modes),
        categories: Object.keys(cats),
        seasons: Object.keys(seasons).sort().reverse(),
        guns: Object.keys(guns)
      });
    }).catch(function () {});
  }

  function loadMeta() {
    if (STATIC_MODE) return loadMetaStatic();
    fetch('/api/meta').then(function (r) { return r.json(); }).then(function (d) {
      if (!d.ok) { STATIC_MODE = true; return loadMetaStatic(); }
      applyMeta(d);
    }).catch(function () {
      // 没有后端 → 自动降级成静态模式（比如只把 static/ 传到了托管）
      STATIC_MODE = true;
      loadMetaStatic();
      fetchPage(true);
    });
  }

  /* ---------------------------------------------------------- 事件 ---------- */

  var qTimer = null;
  el.q.addEventListener('input', function () {
    state.q = el.q.value.trim();
    el.qClear.hidden = !el.q.value;
    clearTimeout(qTimer);
    qTimer = setTimeout(function () { fetchPage(true); }, 220);
  });

  el.qClear.addEventListener('click', function () {
    el.q.value = ''; state.q = '';
    el.qClear.hidden = true;
    el.q.focus();
    fetchPage(true);
  });

  el.sort.addEventListener('change', function () {
    state.sort = el.sort.value;
    fetchPage(true);
  });

  el.resetBtn.addEventListener('click', function () {
    state.q = ''; state.mode = ''; state.category = ''; state.season = '';
    el.q.value = ''; el.qClear.hidden = true;
    el.season.value = '';
    Array.prototype.forEach.call(document.querySelectorAll('.chip'), function (c) {
      c.classList.toggle('on', (c.dataset.val || '') === '');
    });
    fetchPage(true);
  });

  el.loadMore.addEventListener('click', function () { fetchPage(false); });

  el.grid.addEventListener('click', function (e) {
    var btn = e.target.closest('.btn-copy');
    if (!btn) return;
    var card = btn.closest('.card');
    if (!card) return;
    onCopyClick(btn, card, card.dataset.code);
  });

  // 支持 /c/xxx 这种分享链接：直接按码定位
  (function deepLink() {
    var m = location.pathname.match(/^\/c\/([A-Za-z0-9_\-.]+)/);
    if (m && m[1]) {
      el.q.value = m[1];
      state.q = m[1];
      el.qClear.hidden = false;
    }
  })();

  loadMeta();
  fetchPage(true);
})();
