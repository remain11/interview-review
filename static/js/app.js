'use strict';
// 路由、主题、启动
(() => {
  const { $, $$ } = App;

  const applyTheme = () => {
    const t = App.local.theme || 'auto';
    const dark = t === 'dark' || (t === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    $('#hl-dark').disabled = !dark;
    $('#hl-light').disabled = dark;
  };

  const route = () => {
    const [, page = 'review', arg] = location.hash.match(/^#\/(\w+)(?:\/(.+))?/) || [];
    $$('nav a').forEach((a) => a.classList.toggle('active', a.dataset.route === page));
    if (page === 'bank') App.showBank();
    else if (page === 'stats') App.showStats();
    else if (page === 'settings') App.showSettings();
    else {
      App.showReview(arg && decodeURIComponent(arg));
      if (arg) history.replaceState(null, '', '#/review');
    }
    $('#app').focus({ preventScroll: true });
  };

  document.addEventListener('keydown', (e) => {
    if ((location.hash || '#/review').startsWith('#/review')) App.reviewKey(e);
  });
  // 切页面、手机切回前台时拉一下其他设备的进度
  window.addEventListener('hashchange', async () => { route(); if (await App.pull()) route(); });
  window.addEventListener('pagehide', App.flush);
  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState === 'hidden') return App.flush();
    if (await App.pull()) route();
  });

  $('#theme-btn').addEventListener('click', () => {
    const order = ['auto', 'light', 'dark'];
    const t = order[(order.indexOf(App.local.theme || 'auto') + 1) % 3];
    App.local.theme = t;
    App.saveLocal();
    App.toast({ auto: '跟随系统', light: '浅色', dark: '深色' }[t]);
    applyTheme();
  });

  App.load()
    .then(() => {
      applyTheme();
      matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);
      route();
    })
    .catch((err) => {
      $('#app').innerHTML = `<p class="center bad">加载题库失败：${App.esc(err.message)}<br>请用 <code>python server.py</code> 启动后访问。</p>`;
    });
})();
