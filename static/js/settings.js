'use strict';
// 设置页（刷题范围与模式、重置、导入导出）+ 统计页
(() => {
  const { $, esc } = App;

  const countBy = (pred) => App.active().filter(pred).length;

  App.showSettings = () => {
    const s = App.state.settings;
    const catOpts = App.cats.map((c) => [c, c, App.bank.filter((q) => q.category === c && !App.state.excluded[q.id]).length]);
    const srcOpts = App.sources.map((c) => [c, c, App.bank.filter((q) => q.source === c).length]);
    const tagOpts = App.tags.slice(0, 80).map((t) => [t, t, App.tagCount[t]]);
    const modeCnt = (m) => App.active().filter((q) => App.MODES[m].test(App.rec(q.id))).length;
    $('#app').innerHTML = `<section class="card">
      <h2>刷题范围</h2>
      <p class="muted small">都不选 = 全部。这里的筛选只决定“刷题时出哪些题”，不会删除任何题目；想永久不看某题，到“题库”里取消勾选。</p>
      <h3>分类</h3>${App.chips('cats', catOpts, s.cats)}
      <h3>来源</h3>${App.chips('sources', srcOpts, s.sources)}
      <details ${s.tags.length ? 'open' : ''}><summary><h3 class="inline">标签${s.tags.length ? `（已选 ${s.tags.length}）` : ''}</h3></summary>
        <p class="muted small">选中多个标签时，题目带其中任意一个即可。</p>${App.chips('tags', tagOpts, s.tags)}</details>
      <h3>出题模式</h3>
      <div class="radio-list">${Object.entries(App.MODES).map(([k, m]) =>
        `<label><input type="radio" name="mode" value="${k}" ${s.mode === k ? 'checked' : ''}> ${esc(m.label)} <small class="muted">${modeCnt(k)} 题</small></label>`).join('')}</div>
      <h3>出题顺序</h3>
      <div class="radio-list">
        <label><input type="radio" name="order" value="random" ${s.order === 'random' ? 'checked' : ''}> 随机</label>
        <label><input type="radio" name="order" value="weighted" ${s.order === 'weighted' ? 'checked' : ''}> 随机，但不知道/常错的题更容易出现</label>
        <label><input type="radio" name="order" value="seq" ${s.order === 'seq' ? 'checked' : ''}> 按题库顺序</label>
      </div>
      <p class="pool-info">当前设置下可刷 <b>${App.candidates().length}</b> 题，本轮剩余 <b>${App.candidates().filter((q) => !App.state.round.seen[q.id]).length}</b> 题。
        <a class="btn small primary" href="#/review">去刷题</a></p>
    </section>
    <section class="card">
      <h2>重置</h2>
      <div class="reset-list">
        <div><button class="btn" id="r-round">开始新一轮</button><span class="muted small">清空“本轮已做”，作答结果保留。所有符合模式的题会重新出现。</span></div>
        <div><button class="btn" id="r-vague">把“模糊”打回“不知道”</button><span class="muted small">想对模糊题更严格一点时用。</span></div>
        <div><button class="btn danger" id="r-scope">重置当前范围的作答状态</button><span class="muted small">只清除当前分类/来源/标签筛选范围内题目的作答结果，收藏和笔记保留。</span></div>
        <div><button class="btn danger" id="r-all">重置全部作答状态</button><span class="muted small">所有题回到“未做”，收藏、笔记、停用设置都保留。</span></div>
        <div><button class="btn ghost" id="r-excl">恢复全部停用的题</button><span class="muted small">当前停用 ${Object.keys(App.state.excluded).length} 题。</span></div>
      </div>
    </section>
    <section class="card">
      <h2>备份</h2>
      <p class="muted small">答题状态自动保存在 data/state.json（每次写入前会备份为 state.bak.json），浏览器里也有一份副本。</p>
      <div class="row gap"><button class="btn" id="exp">导出进度</button>
        <label class="btn">导入进度<input type="file" id="imp" accept=".json" hidden></label></div>
    </section>
    <section class="card">
      <h2>快捷键</h2>
      <table class="keys"><tr><td><kbd>1</kbd><kbd>2</kbd><kbd>3</kbd></td><td>不知道 / 模糊 / 熟悉（看完答案后可以改选）</td></tr>
        <tr><td><kbd>空格</kbd> / <kbd>Enter</kbd></td><td>下一题</td></tr>
        <tr><td><kbd>→</kbd></td><td>跳过（不计入本轮）</td></tr>
        <tr><td><kbd>S</kbd></td><td>收藏</td></tr><tr><td><kbd>X</kbd></td><td>停用这题</td></tr>
        <tr><td><kbd>Z</kbd></td><td>撤销上一步</td></tr><tr><td><kbd>N</kbd></td><td>写笔记</td></tr></table>
    </section>`;
    bind();
  };

  const bind = () => {
    const root = $('#app');
    const s = App.state.settings;
    App.bindChips(root, (name, vals) => { s[name] = vals; App.save(); App.showSettings(); });
    root.querySelectorAll('input[name=mode], input[name=order]').forEach((el) =>
      el.addEventListener('change', () => { s[el.name] = el.value; App.save(); App.showSettings(); }));
    const clear = (list) => list.forEach((q) => {
      const r = App.state.records[q.id];
      if (r) { delete r.s; r.n = 0; r.log = []; delete r.last; }
      delete App.state.round.seen[q.id];
    });
    $('#r-round').onclick = () => { App.state.round = { seen: {}, started: Date.now() }; App.save(); App.toast('新一轮开始'); App.showSettings(); };
    $('#r-vague').onclick = async () => {
      const n = Object.values(App.state.records).filter((r) => r.s === 'vague').length;
      if (!(await App.confirm(`把 ${n} 道“模糊”题改为“不知道”？`))) return;
      Object.values(App.state.records).forEach((r) => r.s === 'vague' && (r.s = 'unknown'));
      App.save(); App.showSettings();
    };
    $('#r-scope').onclick = async () => {
      const list = App.bank.filter((q) => App.matchFilter(q, s));
      if (!(await App.confirm(`清除当前范围内 ${list.length} 道题的作答记录？此操作不能撤销（可以先导出备份）。`, '重置'))) return;
      clear(list); App.save(); App.toast('已重置'); App.showSettings();
    };
    $('#r-all').onclick = async () => {
      if (!(await App.confirm('清除全部题目的作答记录？此操作不能撤销（可以先导出备份）。', '全部重置'))) return;
      clear(App.bank); App.state.round = { seen: {}, started: Date.now() }; App.save(); App.toast('已全部重置'); App.showSettings();
    };
    $('#r-excl').onclick = () => { App.state.excluded = {}; App.save(); App.showSettings(); };
    $('#exp').onclick = () => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([JSON.stringify(App.state, null, 1)], { type: 'application/json' }));
      a.download = `bagu-progress-${App.today()}.json`;
      a.click();
    };
    $('#imp').onchange = async (e) => {
      const f = e.target.files[0];
      if (!f) return;
      try {
        const data = JSON.parse(await f.text());
        if (!data.version || !data.records) throw new Error('格式不对');
        if (!(await App.confirm('用导入的文件覆盖当前进度？', '覆盖'))) return;
        await App.replaceAll(data);
        App.toast('导入成功'); App.showSettings();
      } catch (err) { App.toast('导入失败：' + err.message); }
    };
  };

  // ---------- 统计 ----------
  App.showStats = () => {
    const act = App.active();
    const total = App.catStats(act);
    const all = Object.values(total).reduce((a, c) => {
      for (const k in c) a[k] = (a[k] || 0) + c[k];
      return a;
    }, {});
    const days = [];
    for (let i = 29; i >= 0; i--) {
      const d = new Date(Date.now() - i * 864e5);
      const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      days.push([k, App.state.daily[k] || 0]);
    }
    const maxDay = Math.max(1, ...days.map((d) => d[1]));
    let streak = 0;
    for (let i = days.length - 1; i >= 0; i--) { if (days[i][1]) streak++; else if (i !== days.length - 1) break; }
    const hard = App.bank
      .map((q) => [q, (App.rec(q.id).log || []).filter((x) => x[1] === 'unknown').length])
      .filter(([q, n]) => n >= 2 && !App.state.excluded[q.id])
      .sort((a, b) => b[1] - a[1]).slice(0, 15);
    $('#app').innerHTML = `<section class="card">
      <h2>总体</h2>
      <div class="kpis">
        <div><b>${all.total || 0}</b><span>启用题目</span></div>
        <div class="st-known-t"><b>${all.known || 0}</b><span>熟悉</span></div>
        <div class="st-vague-t"><b>${all.vague || 0}</b><span>模糊</span></div>
        <div class="st-unknown-t"><b>${all.unknown || 0}</b><span>不知道</span></div>
        <div><b>${all.none || 0}</b><span>未做</span></div>
        <div><b>${streak}</b><span>连续打卡天数</span></div>
      </div>
      ${App.bar(all)}
    </section>
    <section class="card"><h2>分类进度</h2>
      <table class="cat-table">${Object.entries(total).map(([c, v]) => `<tr>
        <td><a class="link" href="#/review" data-cat="${esc(c)}">${esc(c)}</a></td>
        <td class="num">${v.known}/${v.total}</td><td class="bar-cell">${App.bar(v)}</td></tr>`).join('')}</table>
      <p class="muted small">点分类名可以只刷这个分类。</p>
    </section>
    <section class="card"><h2>最近 30 天</h2>
      <div class="days">${days.map(([k, n]) => `<div class="day" title="${k}：${n} 题"><i style="height:${(n / maxDay) * 100}%"></i></div>`).join('')}</div>
    </section>
    ${hard.length ? `<section class="card"><h2>老大难（不知道 ≥ 2 次）</h2><ul class="hard">${hard.map(([q, n]) =>
      `<li><a class="link" href="#/review/${q.id}">${esc(q.title)}</a> <span class="muted small">${esc(q.category)} · 不知道 ${n} 次</span></li>`).join('')}</ul></section>` : ''}`;
    $('#app').querySelectorAll('[data-cat]').forEach((a) => a.addEventListener('click', () => {
      App.state.settings.cats = [a.dataset.cat]; App.save();
    }));
  };
})();
