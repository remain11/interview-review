// 用无头 Chrome (CDP) 跑一遍主要交互，检查控制台报错并截图
import { spawn } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = process.env.PORT || 8766;
const URL0 = `http://127.0.0.1:${PORT}/`;
const profile = mkdtempSync(join(tmpdir(), 'cdp-'));
const proc = spawn(CHROME, ['--headless=new', '--remote-debugging-port=9333', `--user-data-dir=${profile}`, '--window-size=1100,1000', 'about:blank']);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let tabs;
for (let i = 0; i < 40; i++) { try { tabs = await (await fetch('http://127.0.0.1:9333/json')).json(); break; } catch { await sleep(250); } }
const ws = new WebSocket(tabs.find((t) => t.type === 'page').webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0; const pending = {}; const errors = [];
ws.onmessage = (m) => {
  const d = JSON.parse(m.data);
  if (d.id && pending[d.id]) { pending[d.id](d); delete pending[d.id]; }
  if (d.method === 'Runtime.exceptionThrown') errors.push(d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text);
  if (d.method === 'Runtime.consoleAPICalled' && d.params.type === 'error') errors.push(d.params.args.map((a) => a.value ?? a.description).join(' '));
};
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending[i] = r; ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: `(async()=>{${expr}})()`, awaitPromise: true, returnByValue: true });
  if (r.result.exceptionDetails) throw new Error(expr + '\n' + JSON.stringify(r.result.exceptionDetails));
  return r.result.result.value;
};
const shot = async (name) => { const r = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(`shots/${name}.png`, Buffer.from(r.result.data, 'base64')); };
const key = (k) => ev(`document.dispatchEvent(new KeyboardEvent('keydown',{key:${JSON.stringify(k)},bubbles:true}))`);
const check = (cond, msg) => { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (!cond) process.exitCode = 1; };

await send('Runtime.enable'); await send('Page.enable');
await send('Page.navigate', { url: URL0 }); await sleep(1500);

const t1 = await ev(`return document.querySelector('.q-title')?.textContent`);
check(!!t1, '首页显示一道题: ' + t1);
check(await ev(`return !document.querySelector('.answer')`), '作答前不显示答案');
const left0 = await ev(`return +document.querySelector('.progress-text b').textContent`);
await shot('1-question');
await key('1');
await sleep(200);
check(await ev(`return !!document.querySelector('.answer') && !!document.querySelector('#next')`), '按 1 后显示答案和下一题按钮');
check(await ev(`return document.querySelector('.rate-unknown').classList.contains('chosen')`), '不知道被高亮');
await key('3'); await sleep(100);
check(await ev(`return App.rec(App.state.current).s==='known' && App.rec(App.state.current).n===1`), '改选为熟悉，不重复计数');
await shot('2-answer');
const pos = new Set();
for (let i = 0; i < 12; i++) {
  await key(String(1 + (i % 3))); await sleep(60);
  pos.add(await ev(`return document.querySelector('.next-row').className`));
  await key(' '); await sleep(80);
}
check(pos.size > 1, '下一题按钮位置随机: ' + [...pos].join(','));
const left1 = await ev(`return +document.querySelector('.progress-text b').textContent`);
check(left1 === left0 - 12, `本轮剩余递减 ${left0} -> ${left1}`);
await key('z'); await sleep(100);
check(await ev(`return +document.querySelector('.progress-text b').textContent`) === left1 + 1, '撤销后恢复一题');
await key('s'); await sleep(80);
check(await ev(`return !!App.rec(App.state.current).star`), '收藏');
const exId = await ev(`return App.state.current`);
await key('x'); await sleep(100);
check(await ev(`return !!App.state.excluded['${exId}'] && App.state.current!=='${exId}'`), '停用后换题');

// 题库页
await ev(`location.hash='#/bank'`); await sleep(400);
check(await ev(`return document.querySelectorAll('.bank-row').length`) === 60, '题库分页显示 60 条');
await ev(`const k=document.querySelector('#kw'); k.value='虚函数'; k.dispatchEvent(new Event('input'))`); await sleep(500);
const n = await ev(`return document.querySelectorAll('.bank-row').length`);
check(n > 3 && n < 60, '搜索“虚函数”: ' + n + ' 条');
await ev(`document.querySelector('.row-title').click()`); await sleep(300);
check(await ev(`return !!document.querySelector('.row-detail .answer')`), '展开查看答案');
await shot('3-bank');
await ev(`const c=document.querySelector('.bank-row .en'); c.click()`); await sleep(100);
const offId = await ev(`return document.querySelector('.bank-row').dataset.id`);
check(await ev(`return !!App.state.excluded['${offId}']`), '题库取消勾选=停用');

// 设置：只刷操作系统 + 只看不知道
await ev(`location.hash='#/settings'`); await sleep(300);
await ev(`[...document.querySelectorAll('.chips[data-name=cats] .chip')].find(b=>b.dataset.v==='操作系统').click()`); await sleep(200);
check(await ev(`return App.state.settings.cats.join()==='操作系统'`), '设置分类筛选');
await shot('4-settings');
await ev(`location.hash='#/review'`); await sleep(300);
check(await ev(`return App.byId[App.state.current].category==='操作系统'`), '刷题只出操作系统');
await ev(`location.hash='#/stats'`); await sleep(300);
await shot('5-stats');
check(await ev(`return document.querySelectorAll('.cat-table tr').length>0`), '统计页渲染');

// 暗色 + 持久化
await ev(`document.querySelector('#theme-btn').click(); document.querySelector('#theme-btn').click()`);
await sleep(600);
const saved = await (await fetch(`http://127.0.0.1:${PORT}/api/state`)).json();
check(saved.excluded[exId] && saved.settings.cats.join() === '操作系统' && saved.rev > 0, '状态已写入服务端');
check(saved.daily[Object.keys(saved.daily)[0]] === 11, '今日计数 11（12 次作答 - 1 次撤销）: ' + JSON.stringify(saved.daily));

// 模拟另一台设备同时作答：直接打 patch，然后本页切换页面后应该能看到
await fetch(`http://127.0.0.1:${PORT}/api/patch`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ records: { 'xl-os-001': { s: 'known', n: 1, log: [[Date.now(), 'known']], note: '手机写的' } }, daily_inc: { [new Date().toISOString().slice(0, 10)]: 1 } }) });
await ev(`App.ensureRec('xl-os-002').note='电脑写的'; App.save(true)`); await sleep(400);
await ev(`location.hash='#/bank'`); await sleep(600);
check(await ev(`return App.rec('xl-os-001').note==='手机写的' && App.rec('xl-os-002').note==='电脑写的'`), '两台设备的改动都保留');
const both = await (await fetch(`http://127.0.0.1:${PORT}/api/state`)).json();
check(both.records['xl-os-001'].note === '手机写的' && both.records['xl-os-002'].note === '电脑写的', '服务端合并两边改动');
await ev(`location.hash='#/review'`); await sleep(200); await key('2'); await sleep(200);
await shot('6-dark');
await send('Page.reload'); await sleep(1500);
check(await ev(`return App.state.settings.cats.join()==='操作系统' && document.documentElement.dataset.theme==='dark'`), '刷新后状态保留（主题存在本机）');

// 全部重置
await ev(`location.hash='#/settings'`); await sleep(300);
await ev(`document.querySelector('#r-all').click()`); await sleep(100);
await ev(`document.querySelector('#dlg-ok').click()`); await sleep(200);
check(await ev(`return Object.values(App.state.records).every(r=>!r.s)`), '全部重置');
check(await ev(`return Object.values(App.state.records).some(r=>r.star)`), '重置保留收藏');

console.log('JS errors:', errors.length ? errors : 'none');
if (errors.length) process.exitCode = 1;
ws.close(); proc.kill();
