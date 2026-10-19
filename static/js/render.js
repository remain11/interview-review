'use strict';
// 答案渲染、通用小组件
(() => {
  const { $, $$, esc } = App;

  marked.setOptions({ gfm: true, breaks: false });

  App.renderAnswer = (q) => {
    const raw = q.format === 'md' ? marked.parse(q.answer || '') : q.answer || '';
    const html = DOMPurify.sanitize(raw, { ADD_ATTR: ['target', 'loading', 'referrerpolicy'] });
    return html || '<p class="muted">（暂无答案，可以在下方笔记里自己写）</p>';
  };

  App.highlight = (root) => {
    $$('pre code', root).forEach((el) => {
      if (!el.className.includes('language-')) el.classList.add('language-cpp');
      try { hljs.highlightElement(el); } catch (_) { /* 未知语言忽略 */ }
    });
    $$('img', root).forEach((img) => {
      img.loading = 'lazy';
      img.referrerPolicy = 'no-referrer';
      img.addEventListener('click', () => App.zoom(img.src));
    });
    $$('a[href^="http"]', root).forEach((a) => { a.target = '_blank'; a.rel = 'noopener'; });
  };

  App.zoom = (src) => {
    const ov = document.createElement('div');
    ov.className = 'zoom';
    ov.innerHTML = `<img src="${esc(src)}" referrerpolicy="no-referrer" alt="放大图片">`;
    ov.addEventListener('click', () => ov.remove());
    document.body.appendChild(ov);
  };

  App.statusBadge = (s) =>
    s ? `<span class="badge st-${s}">${App.STATUS[s].label}</span>` : '<span class="badge st-none">未做</span>';

  App.toast = (msg, ms = 1800) => {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(t._timer);
    t._timer = setTimeout(() => t.classList.remove('show'), ms);
  };

  App.confirm = (msg, okText = '确定') =>
    new Promise((resolve) => {
      const dlg = $('#dlg');
      $('#dlg-msg').textContent = msg;
      $('#dlg-ok').textContent = okText;
      dlg.returnValue = '';
      dlg.onclose = () => resolve(dlg.returnValue === 'ok');
      dlg.showModal();
    });

  // 多选 chips：opts=[[value,label,count]]，selected 为数组（空=全部）
  App.chips = (name, opts, selected) =>
    `<div class="chips" data-name="${name}" role="group">` +
    opts
      .map(
        ([v, label, cnt]) =>
          `<button type="button" class="chip ${selected.includes(v) ? 'on' : ''}" data-v="${esc(v)}" aria-pressed="${selected.includes(v)}">${esc(label)}${cnt != null ? `<small>${cnt}</small>` : ''}</button>`
      )
      .join('') +
    '</div>';

  App.bindChips = (root, onChange) => {
    $$('.chips', root).forEach((box) =>
      box.addEventListener('click', (e) => {
        const b = e.target.closest('.chip');
        if (!b) return;
        b.classList.toggle('on');
        b.setAttribute('aria-pressed', b.classList.contains('on'));
        onChange(box.dataset.name, $$('.chip.on', box).map((x) => x.dataset.v));
      })
    );
  };

  // 按分类统计各状态数量（只算未排除的题）
  App.catStats = (list) => {
    const m = {};
    for (const q of list) {
      const c = (m[q.category] ||= { total: 0, known: 0, vague: 0, unknown: 0, none: 0 });
      c.total++;
      c[App.rec(q.id).s || 'none']++;
    }
    return m;
  };

  App.bar = (c) => {
    const pct = (k) => (c.total ? (c[k] / c.total) * 100 : 0);
    return `<div class="bar" title="熟悉 ${c.known} / 模糊 ${c.vague} / 不知道 ${c.unknown} / 未做 ${c.none}">
      <i class="st-known" style="width:${pct('known')}%"></i><i class="st-vague" style="width:${pct('vague')}%"></i><i class="st-unknown" style="width:${pct('unknown')}%"></i></div>`;
  };
})();
