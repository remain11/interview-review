'use strict';
// 刷题页
(() => {
  const { $, esc } = App;
  let cur = null; // 当前题
  let revealed = false;
  let ratedId = null; // 本次展示中已经评价过的题，再按按钮视为改选
  let undoStack = []; // [{id, prev, seenBefore}]

  const progress = () => {
    const cand = App.candidates();
    const seen = App.state.round.seen;
    const left = cand.filter((q) => !seen[q.id]).length;
    const done = Object.keys(seen).length;
    return { left, done, today: App.state.daily[App.today()] || 0, active: App.active().length };
  };

  const head = () => {
    const p = progress();
    const s = App.state.settings;
    const filt = [
      s.cats.length ? s.cats.join('、') : '全部分类',
      s.tags.length ? `标签:${s.tags.join('、')}` : '',
      s.sources.length ? `来源:${s.sources.join('、')}` : '',
    ].filter(Boolean).join(' · ');
    return `<div class="review-head">
      <div class="progress-text">本轮剩余 <b>${p.left}</b> 题 · 本轮已做 ${p.done} · 今日 ${p.today} 题</div>
      <div class="muted small">${esc(App.MODES[s.mode].label)} · ${esc(filt)} · 题库启用 ${p.active} 题
        <a href="#/settings" class="link">调整</a></div>
    </div>`;
  };

  const doneView = () => {
    const pending = App.active().filter((q) => App.rec(q.id).s !== 'known').length;
    const emptyPool = App.candidates().length === 0;
    return `${head()}<section class="card done-card">
      <h2>${emptyPool ? '当前筛选下没有题目' : '这一轮刷完了'}</h2>
      <p class="muted">${emptyPool
        ? '换个模式或放宽筛选条件试试。'
        : `还有 <b>${pending}</b> 道没完全熟悉的题，开始新一轮只会出现这些题（模式为“全部”时除外）。`}</p>
      <div class="row gap">
        ${emptyPool ? '' : '<button class="btn primary" id="new-round">开始新一轮</button>'}
        <a class="btn" href="#/settings">调整筛选</a>
        <a class="btn" href="#/stats">看统计</a>
      </div></section>`;
  };

  const qMeta = (q) => {
    const r = App.rec(q.id);
    const last = r.log && r.log.length ? r.log.map((x) => App.STATUS[x[1]].label[0]).slice(-8).join(' ') : '';
    return `<div class="q-meta">
      <span class="badge cat">${esc(q.category)}</span>
      ${q.tags.map((t) => `<span class="badge tag">${esc(t)}</span>`).join('')}
      <span class="badge src">${esc(q.source)}</span>
      ${r.s ? `<span class="muted small">上次：${App.statusBadge(r.s)} 共答 ${r.n} 次${last ? `（${esc(last)}）` : ''}</span>` : ''}
    </div>`;
  };

  const view = () => {
    const q = cur;
    const r = App.rec(q.id);
    const btn = (s) =>
      `<button class="btn rate rate-${s} ${revealed && r.s === s && ratedId === q.id ? 'chosen' : ''}" data-s="${s}">
        ${App.STATUS[s].label}<kbd>${App.STATUS[s].key}</kbd></button>`;
    // “下一题”按钮随机放在左/中/右，防止形成肌肉记忆不看答案就点
    const pos = ['left', 'center', 'right'][Math.floor(Math.random() * 3)];
    return `${head()}<section class="card q-card">
      ${qMeta(q)}
      <h2 class="q-title">${esc(q.title)}</h2>
      ${q.hint && !revealed ? `<details class="hint"><summary>提示</summary>${esc(q.hint)}</details>` : ''}
      <div class="rate-row">${['unknown', 'vague', 'known'].map(btn).join('')}</div>
      ${revealed
        ? `<div class="next-row pos-${pos}"><button class="btn primary next" id="next">下一题 <kbd>空格</kbd></button></div>
           <article class="answer">${App.renderAnswer(q)}</article>
           ${q.url ? `<p class="small"><a class="link" href="${esc(q.url)}" target="_blank" rel="noopener">查看原文 ↗</a></p>` : ''}
           ${(q.source_links || []).length ? `<p class="small muted">出处：${q.source_links.map((l) => `<a class="link" href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.id)} ${esc(l.title)}</a>`).join('；')}</p>` : ''}
           <div class="next-row pos-${pos} bottom"><button class="btn primary next">下一题</button></div>`
        : '<p class="muted small center">先在心里或者说出来作答，再按自己的掌握程度选一个，答案会在选择后出现。<button class="link-btn" id="peek">不评价，直接看答案</button></p>'}
      <div class="q-tools">
        <button class="btn ghost" id="star" aria-pressed="${!!r.star}">${r.star ? '★ 已收藏' : '☆ 收藏'} <kbd>S</kbd></button>
        <button class="btn ghost" id="skip">跳过 <kbd>→</kbd></button>
        <button class="btn ghost" id="exclude">不再出现 <kbd>X</kbd></button>
        <button class="btn ghost" id="undo" ${undoStack.length ? '' : 'disabled'}>撤销 <kbd>Z</kbd></button>
      </div>
      <label class="note-label">我的笔记
        <textarea id="note" rows="2" placeholder="补充自己的理解、面试时被追问的点…（自动保存）">${esc(r.note || '')}</textarea>
      </label>
    </section>`;
  };

  const mount = () => {
    const root = $('#app');
    if (!cur) {
      root.innerHTML = doneView();
      $('#new-round', root)?.addEventListener('click', newRound);
      return;
    }
    root.innerHTML = view();
    if (revealed) App.highlight($('.answer', root));
    root.querySelectorAll('.rate').forEach((b) => b.addEventListener('click', () => rate(b.dataset.s)));
    root.querySelectorAll('.next').forEach((b) => b.addEventListener('click', next));
    $('#peek', root)?.addEventListener('click', () => { revealed = true; mount(); });
    $('#skip', root).addEventListener('click', skip);
    $('#star', root).addEventListener('click', toggleStar);
    $('#exclude', root).addEventListener('click', exclude);
    $('#undo', root).addEventListener('click', undo);
    const note = $('#note', root);
    note.addEventListener('input', () => {
      const rr = App.ensureRec(cur.id);
      rr.note = note.value;
      App.save();
    });
  };

  const setCurrent = (q) => {
    cur = q;
    revealed = false;
    ratedId = null;
    App.state.current = q ? q.id : null;
    App.save();
    mount();
    window.scrollTo({ top: 0 });
  };

  function rate(s) {
    const r = App.ensureRec(cur.id);
    const round = App.state.round.seen;
    if (revealed && ratedId === cur.id) {
      // 已评价过本题，改选：替换最后一条记录
      r.log[r.log.length - 1][1] = s;
      r.s = s;
    } else {
      undoStack.push({ id: cur.id, prev: JSON.parse(JSON.stringify(r)), seenBefore: !!round[cur.id] });
      r.n = (r.n || 0) + 1;
      r.s = s;
      r.last = Date.now();
      r.log.push([r.last, s]);
      ratedId = cur.id;
      round[cur.id] = 1;
      App.state.daily[App.today()] = (App.state.daily[App.today()] || 0) + 1;
    }
    revealed = true;
    App.save();
    mount();
  }

  function next() {
    setCurrent(App.pickNext(cur && cur.id));
  }

  function skip() {
    // 跳过不计入本轮，只换一道
    const q = App.pickNext(cur.id);
    if (!q) return App.toast('没有其他题了');
    setCurrent(q);
  }

  function toggleStar() {
    const r = App.ensureRec(cur.id);
    r.star = !r.star;
    App.save();
    mount();
  }

  async function exclude() {
    const id = cur.id;
    App.state.excluded[id] = 1;
    undoStack.push({ id, excluded: true });
    App.toast('已从题库中停用，可在“题库”页恢复');
    next();
  }

  function undo() {
    const u = undoStack.pop();
    if (!u) return;
    if (u.excluded) delete App.state.excluded[u.id];
    else {
      App.state.records[u.id] = u.prev;
      if (!u.seenBefore) delete App.state.round.seen[u.id];
      const t = App.today();
      if (App.state.daily[t]) App.state.daily[t]--;
    }
    App.toast('已撤销');
    setCurrent(App.byId[u.id]);
  }

  function newRound() {
    App.state.round = { seen: {}, started: Date.now() };
    App.save();
    setCurrent(App.pickNext());
  }

  App.reviewKey = (e) => {
    if (e.target.matches?.('textarea, input, select') || e.target.isContentEditable) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (!cur) return;
    const k = e.key.toLowerCase();
    const map = { 1: 'unknown', 2: 'vague', 3: 'known' };
    if (map[k]) return rate(map[k]);
    if ((k === ' ' || k === 'enter') && revealed) { e.preventDefault(); return next(); }
    if (k === 'arrowright') return skip();
    if (k === 's') return toggleStar();
    if (k === 'x') return exclude();
    if (k === 'z') return undo();
    if (k === 'n') { e.preventDefault(); return $('#note')?.focus(); }
  };

  // 进入刷题页；pickId 用于从题库页“练这题”
  App.showReview = (pickId) => {
    let q = pickId ? App.byId[pickId] : null;
    if (!q && cur && !App.state.excluded[cur.id]) q = cur;
    if (!q && App.state.current) q = App.byId[App.state.current];
    if (q && App.state.excluded[q.id]) q = null;
    // 已经在本轮做过（例如刷新时已评价）就换新的
    if (q && !pickId && !revealed && (App.state.round.seen[q.id] || !App.candidates().includes(q))) q = null;
    if (!q || q !== cur) { cur = q || App.pickNext(); revealed = false; ratedId = null; App.state.current = cur ? cur.id : null; }
    mount();
  };
})();
