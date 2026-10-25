/* Shared shell for MuJoCo replay pages. A page only declares its cases:
 *
 *   ReplayPage({
 *     title:'主要场景3：MuJoCo 模型 3D 回放', intro:'…html…',
 *     cases:[{key:'v1', label:'…', src:'ms3_v1.js', note:'…', cutaway:['ceiling'], translucent:/corridor/}],
 *     view:'follow'   // or 'free' with free:{target:[x,y,z], position:[x,y,z]}
 *   });
 *
 * URL hash: #<key>[@seconds][,full|,simple]  e.g.  #wipe@12,full   (default: simplified)
 */
(function () {
  const css = `:root{--bg:#f3f5f4;--panel:#fff;--fg:#17201c;--muted:#5a6863;--line:#d4dcd8;--accent:#0f6f63;--chip:#e2ece9;color-scheme:light}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#151917;--panel:#1e2421;--fg:#e6ece9;--muted:#9aa8a2;--line:#33403a;--accent:#4fb3a3;--chip:#26302c;color-scheme:dark}}
:root[data-theme="dark"]{--bg:#151917;--panel:#1e2421;--fg:#e6ece9;--muted:#9aa8a2;--line:#33403a;--accent:#4fb3a3;--chip:#26302c;color-scheme:dark}
*{box-sizing:border-box}[hidden]{display:none!important}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.6 "Noto Sans SC","PingFang SC",system-ui,sans-serif}
.wrap{max-width:1280px;margin:0 auto;padding:22px 16px 48px;display:flex;flex-direction:column;gap:12px}
h1{font-size:23px;margin:0}p{margin:0;max-width:85ch}.muted{color:var(--muted)}a{color:var(--accent)}
.cases{display:flex;flex-wrap:wrap;gap:6px}.cases a{font-size:13px;padding:4px 10px;border:1px solid var(--line);background:var(--panel);border-radius:4px;color:var(--fg);text-decoration:none}
.cases a.on{background:var(--accent);color:#fff;border-color:var(--accent)}`;
  window.ReplayPage = function (cfg) {
    const s = document.createElement('style'); s.textContent = css; document.head.appendChild(s);
    document.title = cfg.tabTitle || cfg.title;
    const keys = cfg.cases.map(c => c.key), m = location.hash.match(/^#([^@,]+)/), key = m && keys.includes(m[1]) ? m[1] : keys[0];
    const C = cfg.cases.find(c => c.key === key), t0 = parseFloat((location.hash.match(/@([\d.]+)/) || [, '0'])[1]);
    document.body.innerHTML = `<div class="wrap"><h1>${cfg.title}</h1><p class="muted">${cfg.intro || ''}</p>
      <div class="cases">${cfg.cases.map(c => `<a href="#${c.key}" class="${c.key === key ? 'on' : ''}">${c.label}</a>`).join('')}</div>
      <p class="muted">${C.note || ''}</p><div id="viewer"></div></div>`;
    addEventListener('hashchange', () => location.reload());
    const fail = msg => { const v = document.getElementById('viewer'); v.innerHTML = `<p style="color:#b4410f;padding:12px;border:1px solid #b4410f;border-radius:6px">回放加载失败：${msg}</p>`; };
    let mounted = false; addEventListener('error', e => { if (!mounted) fail(e.message || String(e)); });
    Replay3D.loadCase(C.src, key).then(() => {
      if (!window.THREE) throw new Error('three.js 没有加载上（需要联网访问 cdnjs / jsdelivr）');
      const data = window.CASES[key];
      Replay3D.mount(document.getElementById('viewer'), {
        scene: {kind: 'mujoco', data, cutaway: C.cutaway || data.cutaway || [], translucent: C.translucent},
        mode: /,full/.test(location.hash) ? 'full' : /,simple/.test(location.hash) ? 'simple' : (cfg.mode || 'simple'), t0, view: C.view || cfg.view || 'follow', free: C.free || cfg.free,
        topCenter: cfg.topCenter, phaseNames: cfg.phaseNames,
      }); mounted = true;
    }).catch(e => fail(e.message));
  };
})();
