// Plugin „Minecraft (JustMinecraft)” – most między JustMusic a launcherem Minecrafta JustMinecraft.
// Launcher wystawia lokalny serwer (127.0.0.1). Plugin:
// • odbiera polecenia (Server-Sent Events): graj playlistę, pauza, wznów, głośność, następny…
// • wysyła stan odtwarzacza (utwór, okładka, postęp, playlisty) – launcher pokazuje „teraz gra”,
// • pokazuje listę instancji Minecrafta z przyciskiem „Graj”.

const D = { port: 47851, badge: true };

export default function activate(api) {
  const { h } = api;
  const cfg = () => ({ ...D, ...api.storage.get('cfg', {}) });
  const base = () => `http://127.0.0.1:${cfg().port}`;

  let es = null;
  let connected = false;
  let game = null;
  let retry = 3000;
  let retryTimer = null;
  let stopped = false;
  let savedVolume = null;
  const redraws = new Set();
  const refresh = () => { for (const r of redraws) { try { r(); } catch (e) { console.error(e); } } };

  // ---------- znacznik na pasku tytułu ----------
  const badge = api.ui.addTitlebarItem({ id: 'mc', icon: 'sparkles', text: 'Minecraft', title: 'JustMinecraft', onClick: () => api.ui.openView('main') });
  const drawBadge = () => {
    badge.show(cfg().badge && !!game);
    if (game) badge.set({ text: `Minecraft · ${game.name}`, title: `Gra: ${game.name} (${game.mc})` });
  };
  drawBadge();

  // ---------- stan dla launchera ----------
  const thumbCache = new Map();
  async function thumbOf(t) {
    if (!t?.thumb) return '';
    if (/^https:\/\//.test(t.thumb)) return t.thumb;
    if (thumbCache.has(t.thumb)) return thumbCache.get(t.thumb);
    let url = '';
    try {
      const b = await (await fetch(t.thumb)).blob();
      if (b.size < 400000) url = await new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => res(''); r.readAsDataURL(b); });
    } catch {}
    if (thumbCache.size > 50) thumbCache.clear();
    thumbCache.set(t.thumb, url);
    return url;
  }

  async function playlists() {
    const out = [];
    for (const p of api.library.playlists || []) {
      const first = p.trackIds?.[0] ? api.library.getTrack(p.trackIds[0]) : null;
      out.push({ id: p.id, name: p.name, count: p.trackIds?.length || 0, thumb: first ? await thumbOf(first) : '' });
    }
    return out;
  }

  let plCache = null;
  let plAt = 0;
  async function state(full) {
    const t = api.player.current;
    if (full || !plCache || Date.now() - plAt > 30000) { plCache = await playlists(); plAt = Date.now(); }
    return {
      track: t ? { title: t.title || 'Bez tytułu', artist: t.artist || '', thumb: await thumbOf(t) } : null,
      playing: !!api.player.playing,
      time: api.player.time || 0,
      duration: api.player.duration || 0,
      volume: api.player.volume ?? 1,
      playlists: plCache,
    };
  }

  let pushTimer = null;
  function push(full) {
    if (!connected) return;
    clearTimeout(pushTimer);
    pushTimer = setTimeout(async () => {
      try {
        await fetch(`${base()}/state`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-JustLauncher': '1' }, body: JSON.stringify(await state(full)) });
      } catch {}
    }, 150);
  }

  let lastTime = 0;
  api.player.on('track', () => push());
  api.player.on('state', () => push());
  api.player.on('volume', () => push());
  api.player.on('time', () => { const n = Date.now(); if (n - lastTime > 2000) { lastTime = n; push(); } });

  // ---------- polecenia z launchera ----------
  function shuffled(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }

  function command(m) {
    switch (m.cmd) {
      case 'toggle': api.player.toggle(); break;
      case 'play': case 'resume': if (!api.player.playing) { if (api.player.current) api.player.resume(); } break;
      case 'pause': if (api.player.playing) api.player.pause(); break;
      case 'next': api.player.next(); break;
      case 'prev': api.player.prev(); break;
      case 'shuffle': api.commands.run('player.shuffle'); break;
      case 'volume':
        if (m.remember && savedVolume == null) savedVolume = api.player.volume;
        api.player.setVolume(Math.max(0, Math.min(1, Number(m.value) || 0)));
        break;
      case 'volume-restore':
        if (savedVolume != null) { api.player.setVolume(savedVolume); savedVolume = null; }
        break;
      case 'play-playlist': {
        const pl = (api.library.playlists || []).find((p) => p.id === m.id);
        if (!pl) { api.ui.toast('Minecraft: nie znaleziono playlisty wybranej w launcherze', { error: true }); break; }
        const tracks = (pl.trackIds || []).map((id) => api.library.getTrack(id)).filter(Boolean);
        if (!tracks.length) break;
        api.player.play(m.shuffle ? shuffled(tracks) : tracks, 0);
        break;
      }
      default: break;
    }
    push();
  }

  function onMessage(ev) {
    let m;
    try { m = JSON.parse(ev.data); } catch { return; }
    if (m.type === 'hello') { game = m.game || null; drawBadge(); push(true); refresh(); }
    else if (m.type === 'game') {
      const was = game;
      game = m.game || null;
      drawBadge();
      if (game && !was) api.ui.toast(`Minecraft uruchomiony: ${game.name}`, { duration: 3000 });
      refresh();
    } else if (m.type === 'cmd') command(m);
  }

  // ---------- połączenie (z ponawianiem) ----------
  function connect() {
    if (stopped) return;
    clearTimeout(retryTimer);
    try { es?.close(); } catch {}
    es = new EventSource(`${base()}/events`);
    es.onopen = () => { connected = true; retry = 3000; refresh(); push(true); };
    es.onmessage = onMessage;
    es.onerror = () => {
      const was = connected;
      connected = false;
      try { es.close(); } catch {}
      es = null;
      if (was) { game = null; drawBadge(); refresh(); }
      retryTimer = setTimeout(connect, retry);
      retry = Math.min(30000, retry * 1.5);
    };
  }
  connect();

  // ---------- widok „Minecraft” ----------
  api.ui.addView({
    id: 'main', title: 'Minecraft', icon: 'sparkles',
    render(el) {
      const box = h('div', { style: 'padding: 24px; max-width: 900px' });
      el.append(box);
      let alive = true;
      const draw = async () => {
        if (!alive) return;
        box.replaceChildren();
        box.append(h('h1', { style: 'margin: 0 0 6px' }, 'Minecraft'),
          h('p', { style: 'opacity: .7; margin: 0 0 18px' }, connected ? 'Połączono z JustMinecraftem.' : 'Uruchom JustMinecraft, aby się połączyć (łączę się automatycznie).'));
        if (!connected) {
          box.append(api.ui.button('Pobierz JustMinecraft', { primary: true, onClick: () => window.open('https://github.com/kusiakbartek771/JustMinecraft/releases/latest') }));
          return;
        }
        let data = { instances: [] };
        try { data = await (await fetch(`${base()}/instances`)).json(); } catch {}
        if (!alive) return;
        if (!data.instances.length) { box.append(h('p', null, 'Brak instancji – utwórz je w launcherze.')); return; }
        const list = h('div', { style: 'display: flex; flex-direction: column; gap: 8px' });
        for (const i of data.instances.sort((a, b) => (b.lastPlayed || 0) - (a.lastPlayed || 0))) {
          const ic = i.icon && !/^data:|^https?:/.test(i.icon) ? i.icon : '⛏️';
          list.append(h('div', { style: 'display: flex; align-items: center; gap: 12px; padding: 10px 14px; border-radius: 12px; background: var(--surface-2, rgba(255,255,255,.05))' },
            h('div', { style: 'font-size: 24px; width: 36px; text-align: center' }, ic),
            h('div', { style: 'flex: 1; min-width: 0' }, h('b', null, i.name), h('div', { style: 'opacity: .65; font-size: 12px' }, `${i.loader} ${i.mc}${i.running ? ' · uruchomiona' : ''}`)),
            api.ui.button(i.running ? 'Działa' : 'Graj', { primary: !i.running, onClick: async () => {
              try {
                const r = await fetch(`${base()}/launch`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-JustLauncher': '1' }, body: JSON.stringify({ id: i.id }) });
                const j = await r.json();
                if (!r.ok) throw new Error(j.error || 'Błąd');
                api.ui.toast(`Uruchamiam ${i.name}…`);
              } catch (e) { api.ui.toast(e.message, { error: true }); }
            } })));
        }
        box.append(list);
      };
      redraws.add(draw);
      draw();
      return () => { alive = false; redraws.delete(draw); };
    },
  });

  // ---------- ustawienia ----------
  api.ui.addSettings((el) => {
    const c = cfg();
    const port = h('input', { type: 'number', value: String(c.port), min: '1024', max: '65535', style: 'width: 110px' });
    port.addEventListener('change', () => { api.storage.set('cfg', { ...cfg(), port: Math.max(1024, Math.min(65535, Number(port.value) || 47851)) }); connect(); });
    el.append(
      api.ui.settingRow('Port JustMinecrafta', 'Taki sam jak w launcherze (Ustawienia → JustMusic). Domyślnie 47851.', port),
      api.ui.settingRow('Znacznik na pasku tytułu', 'Pokazuje, w co grasz', api.ui.switch(c.badge, (v) => { api.storage.set('cfg', { ...cfg(), badge: v }); drawBadge(); })),
      api.ui.settingRow('Stan', connected ? 'Połączono z JustMinecraftem' : 'Brak połączenia – uruchom launcher'));
  });

  return () => {
    stopped = true;
    clearTimeout(retryTimer);
    clearTimeout(pushTimer);
    try { es?.close(); } catch {}
    if (savedVolume != null) api.player.setVolume(savedVolume);
  };
}
