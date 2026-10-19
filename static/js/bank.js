'use strict';
// 题库页：搜索、筛选、勾选启用/停用、单题查看
(() => {
  const { $, $$, esc } = App;
  const PAGE = 60;
  const ui = { q: '', cats: [], tags: [], status: 'all', enabled: 'all', limit: PAGE, open: null };

  const STATUS_OPTS = [
    ['all', '全部状态'], ['none', '未做'], ['unknown', '不知道'], ['vague', '模糊'], ['known', '熟悉'], ['star', '收藏'], ['note', '有笔记'],
  ];

  const filtered = () => {
    const kw = ui.q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return App.bank.filter((q) => {
      const r = App.rec(q.id);
      if (ui.cats.length && !ui.cats.includes(q.category)) return false;
      if (ui.tags.length && !q.tags.some((t) => ui.tags.includes(t))) return false;
      if (ui.enabled === 'on' && App.state.excluded[q.id]) return false;
      if (ui.enabled === 'off' && !App.state.excluded[q.id]) return false;
      const st = ui.status;
      if (st === 'none' && r.s) return false;
      if (['unknown', 'vague', 'known'].includes(st) && r.s !== st) return false;
      if (st === 'star' && !r.star) return false;
      if (st === 'note' && !r.note) return false;
      if (kw.length) {
        const hay = `${q.title} ${q.tags.join(' ')} ${q.category} ${r.note || ''}`.toLowerCase();
        if (!kw.every((k) => hay.includes(k))) return false;
      }
      return true;
    });
  };

  const row = (q) => {
    const r = App.rec(q.id);
    const off = !!App.state.excluded[q.id];
    const open = ui.open === q.id;
    return `<li class="bank-row ${off ? 'off' : ''}" data-id="${q.id}">
      <label class="chk" title="${off ? '已停用，勾选以恢复' : '取消勾选则不再出现在刷题中'}">
        <input type="checkbox" class="en" ${off ? '' : 'checked'} aria-label="启用该题"></label>
      <button class="row-title" aria-expanded="${open}">${esc(q.title)}</button>
      <span class="row-meta">${r.star ? '<span title="已收藏">★</span>' : ''}${r.note ? '<span title="有笔记">✎</span>' : ''}
        <span class="badge cat">${esc(q.category)}</span>${App.statusBadge(r.s)}</span>
      ${open ? `<div class="row-detail">
          <div class="q-meta">${q.tags.map((t) => `<span class="badge tag">${esc(t)}</span>`).join('')}<span class="badge src">${esc(q.source)}</span>
            ${r.n ? `<span class="muted small">答过 ${r.n} 次</span>` : ''}</div>
          <div class="row gap small-gap">
            <a class="btn small" href="#/review/${q.id}">练这题</a>
            <button class="btn small ghost reset-one" ${r.s ? '' : 'disabled'}>清除作答记录</button>
            ${q.url ? `<a class="btn small ghost" href="${esc(q.url)}" target="_blank" rel="noopener">原文 ↗</a>` : ''}
          </div>
          ${r.note ? `<p class="note-view"><b>我的笔记：</b>${esc(r.note)}</p>` : ''}
          <article class="answer">${App.renderAnswer(q)}</article></div>` : ''}
    </li>`;
  };

  const mount = () => {
    const list = filtered();
    const shown = list.slice(0, ui.limit);
    const offCnt = list.filter((q) => App.state.excluded[q.id]).length;
    const catOpts = App.cats.map((c) => [c, c, App.bank.filter((q) => q.category === c).length]);
    const tagOpts = App.tags.slice(0, 60).map((t) => [t, t, App.tagCount[t]]);
    $('#app').innerHTML = `<section class="card">
      <div class="bank-tools">
        <input type="search" id="kw" placeholder="搜索题目 / 标签 / 笔记，空格分隔多个关键词" value="${esc(ui.q)}" aria-label="搜索">
        <select id="st" aria-label="作答状态">${STATUS_OPTS.map(([v, l]) => `<option value="${v}" ${ui.status === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
        <select id="en" aria-label="启用状态">
          <option value="all" ${ui.enabled === 'all' ? 'selected' : ''}>启用+停用</option>
          <option value="on" ${ui.enabled === 'on' ? 'selected' : ''}>只看启用</option>
          <option value="off" ${ui.enabled === 'off' ? 'selected' : ''}>只看停用</option></select>
      </div>
      <details class="filter-box" ${ui.cats.length || ui.tags.length ? 'open' : ''}><summary>分类与标签筛选${ui.cats.length + ui.tags.length ? `（已选 ${ui.cats.length + ui.tags.length}）` : ''}</summary>
        <div class="muted small">分类</div>${App.chips('cats', catOpts, ui.cats)}
        <div class="muted small">标签（常用前 60 个）</div>${App.chips('tags', tagOpts, ui.tags)}
      </details>
      <div class="bulk row gap">
        <span>共 <b>${list.length}</b> 题，其中停用 ${offCnt}</span>
        <button class="btn small" id="en-all">全部启用</button>
        <button class="btn small ghost" id="dis-all">全部停用</button>
        <span class="muted small">（批量操作只作用于当前筛选结果，停用的题不会被删除）</span>
      </div>
      <ul class="bank-list">${shown.map(row).join('')}</ul>
      ${list.length > shown.length ? `<button class="btn wide" id="more">再显示 ${Math.min(PAGE, list.length - shown.length)} 题（剩 ${list.length - shown.length}）</button>` : ''}
    </section>`;
    bind(list);
    if (ui.open) App.highlight($(`.bank-row[data-id="${ui.open}"] .answer`) || document.createElement('div'));
  };

  let kwTimer;
  const bind = (list) => {
    const root = $('#app');
    const kw = $('#kw', root);
    kw.addEventListener('input', () => {
      clearTimeout(kwTimer);
      kwTimer = setTimeout(() => {
        ui.q = kw.value; ui.limit = PAGE; mount();
        const k = $('#kw'); k.focus(); k.setSelectionRange(k.value.length, k.value.length);
      }, 200);
    });
    $('#st', root).addEventListener('change', (e) => { ui.status = e.target.value; ui.limit = PAGE; mount(); });
    $('#en', root).addEventListener('change', (e) => { ui.enabled = e.target.value; ui.limit = PAGE; mount(); });
    App.bindChips(root, (name, vals) => { ui[name] = vals; ui.limit = PAGE; mount(); });
    $('#more', root)?.addEventListener('click', () => { ui.limit += PAGE; mount(); });
    $('#en-all', root).addEventListener('click', () => { list.forEach((q) => delete App.state.excluded[q.id]); App.save(); mount(); });
    $('#dis-all', root).addEventListener('click', async () => {
      if (!(await App.confirm(`停用当前筛选出的 ${list.length} 道题？之后可随时恢复。`, '停用'))) return;
      list.forEach((q) => (App.state.excluded[q.id] = 1));
      App.save(); mount();
    });
    $$('.bank-row', root).forEach((li) => {
      const id = li.dataset.id;
      $('.en', li).addEventListener('change', (e) => {
        if (e.target.checked) delete App.state.excluded[id];
        else App.state.excluded[id] = 1;
        li.classList.toggle('off', !e.target.checked);
        App.save();
      });
      $('.row-title', li).addEventListener('click', () => { ui.open = ui.open === id ? null : id; mount(); });
      $('.reset-one', li)?.addEventListener('click', () => {
        const r = App.state.records[id];
        if (r) { delete r.s; r.n = 0; r.log = []; delete r.last; }
        delete App.state.round.seen[id];
        App.save(); mount();
      });
    });
  };

  App.showBank = mount;
})();
