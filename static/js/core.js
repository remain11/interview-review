'use strict';
// 全局命名空间、状态持久化、题目池计算
const App = (window.App = {});
App.$ = (s, el = document) => el.querySelector(s);
App.$$ = (s, el = document) => [...el.querySelectorAll(s)];
App.esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

App.STATUS = {
  unknown: { label: '不知道', key: '1' },
  vague: { label: '模糊', key: '2' },
  known: { label: '熟悉', key: '3' },
};

// records[id] = { s: 最近一次评价, n: 作答次数, last: 时间戳, star, note, log: [[ts, s], ...] }
// round.seen[id] = 1 表示本轮已经出现过；daily[日期] = 当天作答题数
App.defaultState = () => ({
  version: 1,
  records: {},
  excluded: {},
  round: { seen: {}, started: Date.now() },
  daily: {},
  current: null,
  settings: { cats: [], tags: [], sources: [], mode: 'pending', order: 'random' },
});

App.today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

App.rec = (id) => App.state.records[id] || {};
App.ensureRec = (id) => (App.state.records[id] ||= { n: 0, log: [] });

// 每台设备自己的东西（当前题、主题）存在 localStorage，不同步
App.local = JSON.parse(localStorage.getItem('bagu-local') || '{}');
App.saveLocal = () => localStorage.setItem('bagu-local', JSON.stringify(App.local));

const getJSON = async (url) => {
  const r = await fetch(url);
  if (r.status === 401) { location.reload(); throw new Error('需要口令'); }
  if (!r.ok) throw new Error(`${url} ${r.status}`);
  return r.json();
};

// 用服务端数据构造 App.state，并记录快照 App.snap（之后 diff 出增量）
const adopt = (server) => {
  const def = App.defaultState();
  const st = { ...def, ...server, settings: { ...def.settings, ...(server.settings || {}) } };
  st.round ||= def.round;
  st.current = App.local.current || null;
  App.rev = server.rev || 0;
  App.state = st;
  App.snap = JSON.parse(JSON.stringify(st, dropTransient));
};
const dropTransient = (k, v) => (k === 'current' || k === 'theme' ? undefined : v);

App.load = async () => {
  const [bank, server] = await Promise.all([getJSON('/api/bank'), getJSON('/api/state')]);
  App.bank = bank;
  App.byId = Object.fromEntries(bank.map((q) => [q.id, q]));
  adopt(server);
  // 服务端还没有数据、但浏览器里有旧备份：用备份并上传
  const local = JSON.parse(localStorage.getItem('bagu-state') || 'null');
  if (!App.rev && !Object.keys(App.state.records).length && local && local.records && Object.keys(local.records).length) {
    Object.assign(App.state, { records: local.records, excluded: local.excluded || {}, round: local.round || App.state.round });
    App.save(true);
  }
  const ORDER = ['C++', '操作系统', '计算机网络', '计算机组成', '数据结构与算法', '数据库', '多线程与并发', '手撕代码', '概率与智力', '量化业务', 'Python与工程', '项目与BQ'];
  const rank = (c) => (ORDER.includes(c) ? ORDER.indexOf(c) : ORDER.length);
  App.cats = [...new Set(bank.map((q) => q.category))].sort((a, b) => rank(a) - rank(b));
  App.sources = [...new Set(bank.map((q) => q.source))];
  const tagCount = {};
  bank.forEach((q) => q.tags.forEach((t) => (tagCount[t] = (tagCount[t] || 0) + 1)));
  App.tags = Object.keys(tagCount).sort((a, b) => tagCount[b] - tagCount[a]);
  App.tagCount = tagCount;
};

// ---------- 增量同步 ----------
// 把当前 state 和上次同步的快照比较，只上传变化的题目，避免两台设备互相覆盖
const diffMap = (cur, old) => {
  const out = {};
  for (const k of Object.keys(cur)) {
    const a = JSON.stringify(cur[k], dropTransient);
    if (a !== JSON.stringify(old[k], dropTransient)) out[k] = JSON.parse(a);
  }
  for (const k of Object.keys(old)) if (!(k in cur)) out[k] = null;
  return out;
};

App.makePatch = () => {
  const st = App.state, sn = App.snap;
  const p = {};
  const rec = diffMap(st.records, sn.records);
  if (Object.keys(rec).length) p.records = rec;
  const ex = diffMap(st.excluded, sn.excluded);
  if (Object.keys(ex).length) p.excluded = ex;
  if (st.round.started !== sn.round.started) p.round_started = st.round.started;
  const seen = diffMap(st.round.seen, st.round.started === sn.round.started ? sn.round.seen : {});
  if (Object.keys(seen).length) p.seen = seen;
  const inc = {};
  for (const d of new Set([...Object.keys(st.daily), ...Object.keys(sn.daily)])) {
    const x = (st.daily[d] || 0) - (sn.daily[d] || 0);
    if (x) inc[d] = x;
  }
  if (Object.keys(inc).length) p.daily_inc = inc;
  if (JSON.stringify(st.settings, dropTransient) !== JSON.stringify(sn.settings, dropTransient)) p.settings = JSON.parse(JSON.stringify(st.settings, dropTransient));
  return Object.keys(p).length ? p : null;
};

let saveTimer = null, saving = null;
const persistLocal = () => {
  App.local.current = App.state.current;
  App.saveLocal();
  localStorage.setItem('bagu-state', JSON.stringify(App.state, dropTransient));
};

const push = async () => {
  saveTimer = null;
  const p = App.makePatch();
  if (!p) return App.setSaveState('已保存');
  const sent = JSON.parse(JSON.stringify(App.state, dropTransient));
  App.setSaveState('保存中…');
  try {
    const r = await fetch('/api/patch', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(p) });
    if (r.status === 401) throw new Error('口令失效，请刷新页面重新输入');
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const { rev } = await r.json();
    App.snap = sent;
    // 中间有其他设备写过（rev 跳号），之后切页面时会拉取最新数据
    if (rev !== App.rev + 1) App.stale = true;
    App.rev = rev;
    App.setSaveState('已保存');
  } catch (e) {
    App.setSaveState('保存失败：' + (e.message.includes('fetch') ? '连不上电脑' : e.message), true);
    saveTimer = setTimeout(save, 5000); // 稍后重试
  }
};
const save = () => { saving = (saving || Promise.resolve()).then(push); return saving; };

App.save = (immediate = false) => {
  persistLocal();
  clearTimeout(saveTimer);
  App.setSaveState('保存中…');
  if (immediate) return save();
  saveTimer = setTimeout(save, 400);
};
App.flush = () => {
  persistLocal();
  const p = App.makePatch();
  if (!p) return;
  clearTimeout(saveTimer);
  navigator.sendBeacon('/api/patch', new Blob([JSON.stringify(p)], { type: 'application/json' }));
  App.snap = JSON.parse(JSON.stringify(App.state, dropTransient));
};

// 从服务端拉取其他设备的改动（切换页面 / 回到前台时调用）。本地有未同步的改动则先推上去。
App.pull = async () => {
  if (App.makePatch()) await App.save(true);
  try {
    const server = await getJSON('/api/state');
    if (server.rev === App.rev && !App.stale) return false;
    App.stale = false;
    const cur = App.state.current;
    adopt(server);
    App.state.current = cur;
    return true;
  } catch (_) { return false; }
};

// 导入进度：整体覆盖服务端
App.replaceAll = async (data) => {
  const r = await fetch('/api/state', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  adopt(await getJSON('/api/state'));
};
App.setSaveState = (text, bad) => {
  const el = App.$('#save-state');
  el.textContent = text;
  el.classList.toggle('bad', !!bad);
  el.classList.remove('fade');
  clearTimeout(el._t);
  if (text === '已保存') el._t = setTimeout(() => el.classList.add('fade'), 1200);
};

// ---------- 题目池 ----------
App.matchFilter = (q, f) =>
  (!f.cats.length || f.cats.includes(q.category)) &&
  (!f.sources.length || f.sources.includes(q.source)) &&
  (!f.tags.length || q.tags.some((t) => f.tags.includes(t)));

App.active = () => App.bank.filter((q) => !App.state.excluded[q.id] && App.matchFilter(q, App.state.settings));

App.MODES = {
  pending: { label: '未熟悉（不知道+模糊+没做过）', test: (r) => r.s !== 'known' },
  unseen: { label: '只看没做过的', test: (r) => !r.s },
  unknown: { label: '只看不知道', test: (r) => r.s === 'unknown' },
  vague: { label: '只看模糊', test: (r) => r.s === 'vague' },
  starred: { label: '只看收藏', test: (r) => !!r.star },
  all: { label: '全部（含已熟悉）', test: () => true },
};

App.candidates = () => {
  const test = (App.MODES[App.state.settings.mode] || App.MODES.pending).test;
  return App.active().filter((q) => test(App.rec(q.id)));
};

App.pickNext = (excludeId) => {
  const seen = App.state.round.seen;
  const pool = App.candidates().filter((q) => !seen[q.id] && q.id !== excludeId);
  if (!pool.length) return null;
  const order = App.state.settings.order;
  if (order === 'seq') return pool[0];
  if (order === 'weighted') {
    // 不知道 > 没做过 > 模糊 > 熟悉，答错次数越多权重越大
    const w = (q) => {
      const r = App.rec(q.id);
      const miss = (r.log || []).filter((x) => x[1] !== 'known').length;
      return ({ unknown: 4, vague: 2.5, known: 1 }[r.s] || 3) + Math.min(miss, 5) * 0.5;
    };
    let total = pool.reduce((s, q) => s + w(q), 0);
    let x = Math.random() * total;
    for (const q of pool) if ((x -= w(q)) <= 0) return q;
  }
  return pool[Math.floor(Math.random() * pool.length)];
};
