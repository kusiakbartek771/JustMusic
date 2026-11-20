// Plugin: Discord – status „Słucha …” (Rich Presence) + przyciszanie, gdy ktoś mówi.
const LOGO = 'https://raw.githubusercontent.com/kusiakbartek771/JustMusic/main/assets/icon.png';

export default function activate(api) {
  const { h, esc } = api;
  const D = {
    appId: '', secret: '', showCover: true, showTime: true, showPaused: true, showButton: true,
    privacy: false, mode: 'active', listName: 'app', showLogo: true, duck: false, duckLevel: 25, duckSelf: false, duckMethod: 'auto', duckSens: 60, afkStatus: true,
  };
  const cfg = () => ({ ...D, ...api.storage.get('cfg', {}) });
  const save = (patch) => api.storage.set('cfg', { ...cfg(), ...patch });

  let status = { connected: false, user: null, voice: {} };
  let lastErr = '';
  let afk = !!api.bus.last('afk');
  const speaking = new Set();
  let audioSpeaking = false;   // wykrywanie po dźwięku (Linux)
  let audioApps = [];
  let meterCb = null;
  // auto: na Linuksie po dźwięku (działa też z Vesktop/Vencord), gdzie indziej przez Discord RPC
  const duckMethod = () => {
    const m = cfg().duckMethod;
    if (!api.voice) return 'rpc'; // starsza wersja JustMusic
    if (m === 'audio' || m === 'rpc') return m;
    return api.system.platform === 'linux' ? 'audio' : 'rpc';
  };
  // czułość 0..100 → próg poziomu dźwięku (RMS)
  const threshold = (sens) => 0.003 + 0.04 * Math.pow(1 - sens / 100, 1.6);
  let releaseTimer = null;
  let refreshSettings = () => {};

  const pad = (s, fallback) => {
    s = String(s || '').trim();
    if (s.length < 2) s = fallback;
    return s.length > 128 ? s.slice(0, 125) + '…' : s;
  };

  function buildActivity() {
    const c = cfg();
    const t = api.player.current;
    if (!t) return null;
    const playing = api.player.playing;
    if (c.mode === 'dnd') return null; // „Nie przeszkadzać” – bez statusu muzyki
    if (c.mode === 'private') c.privacy = true;
    if (!playing && !c.showPaused && !afk) return null;
    // status_display_type: 0 = „Słucha JustMusic”, 2 = „Słucha <tytuł>” na liście członków
    const a = { type: 2, status_display_type: c.listName === 'song' && !c.privacy ? 2 : 0, instance: false };
    if (c.privacy) {
      a.details = 'Słucha muzyki';
      a.state = afk ? '💤 AFK · JustMusic' : 'w JustMusic';
    } else {
      a.details = pad(t.title, 'Bez tytułu');
      const who = t.artist ? t.artist : 'JustMusic';
      a.state = pad(afk ? `💤 AFK · ${who}` : playing ? who : `⏸ Wstrzymano · ${who}`, 'JustMusic');
    }
    a.assets = { large_text: pad(c.privacy ? 'JustMusic' : t.album ? `${t.album} · JustMusic` : 'JustMusic', 'JustMusic') };
    const art = t.thumb && /^https:\/\//.test(t.thumb) ? t.thumb.replace('/mqdefault.jpg', '/hqdefault.jpg') : null;
    if (c.showCover && art && !c.privacy) a.assets.large_image = art;
    // logo JustMusic: mała ikona przy okładce albo duży obrazek, gdy okładki brak
    if (c.showLogo) {
      if (a.assets.large_image) { a.assets.small_image = LOGO; a.assets.small_text = 'JustMusic'; }
      else a.assets.large_image = LOGO;
    }
    if (playing && c.showTime) {
      const dur = api.player.duration;
      const start = Date.now() - api.player.time * 1000;
      a.timestamps = { start: Math.round(start) };
      if (dur && Number.isFinite(dur)) a.timestamps.end = Math.round(start + dur * 1000);
    }
    if (c.showButton && !c.privacy) {
      const url = t.ytId ? `https://www.youtube.com/watch?v=${t.ytId}` : t.spotifyId ? `https://open.spotify.com/track/${t.spotifyId}` : null;
      if (url) a.buttons = [{ label: t.ytId ? 'Posłuchaj na YouTube' : 'Otwórz w Spotify', url }];
    }
    return a;
  }

  // Discord ogranicza aktualizacje (~5 na 20 s) – zbieramy zmiany
  let pushTimer = null;
  let lastPush = 0;
  function push(now = false) {
    clearTimeout(pushTimer);
    const wait = now ? 0 : Math.max(800, 4000 - (Date.now() - lastPush));
    pushTimer = setTimeout(async () => {
      if (!status.connected) return;
      lastPush = Date.now();
      try { await api.discord.setActivity(buildActivity()); } catch (e) { lastErr = e.message; }
    }, wait);
  }

  async function connect(silent = false) {
    const c = cfg();
    if (!c.appId) return;
    try {
      status = await api.discord.connect(c.appId);
      lastErr = '';
      push(true);
      if (c.duck && c.secret && duckMethod() === 'rpc') api.discord.voice({ enabled: true, secret: c.secret, interactive: false }).catch((e) => { lastErr = e.message === 'AUTH_REQUIRED' ? 'Kliknij „Połącz konto”, aby włączyć przyciszanie' : e.message; refreshSettings(); });
    } catch (e) {
      lastErr = e.message;
      if (!silent) api.ui.toast('Discord: ' + e.message, { error: true });
    }
    refreshSettings();
  }

  // ---- przyciszanie, gdy ktoś mówi ----
  function updateDuck() {
    const c = cfg();
    clearTimeout(releaseTimer);
    if (c.duck && (speaking.size || audioSpeaking)) api.player.duck(c.duckLevel / 100, 250);
    else releaseTimer = setTimeout(() => api.player.duck(1, 900), 700);
  }

  api.discord.on(({ type, payload }) => {
    if (type === 'status') { status = payload; refreshSettings(); if (payload.connected) push(true); }
    else if (type === 'error') { lastErr = payload; refreshSettings(); }
    else if (type === 'speaking') {
      if (payload.self && !cfg().duckSelf) return;
      if (payload.speaking) speaking.add(payload.userId); else speaking.delete(payload.userId);
      updateDuck();
    } else if (type === 'speaking-reset') { speaking.clear(); updateDuck(); }
  });

  api.player.on('track', () => push());
  api.player.on('state', () => push());
  // przewinięcie = nowe znaczniki czasu
  let lastT = 0;
  api.player.on('time', () => {
    const t = api.player.time;
    if (Math.abs(t - lastT) > 3) push();
    lastT = t;
  });
  api.bus.on('afk', (v) => { if (cfg().afkStatus) { afk = !!v; push(true); } });

  // ---- ustawienia ----
  api.ui.addSettings((el) => {
    const draw = () => {
      const c = cfg();
      const S = (label, hint, key) => api.ui.settingRow(label, hint, api.ui.switch(c[key], (v) => { save({ [key]: v }); push(true); if (key === 'duck') toggleDuck(v); draw(); }));
      const input = (key, placeholder, type = 'text') => {
        const i = h('input.input', { type, placeholder, style: { width: '260px' } });
        i.value = c[key] || '';
        i.addEventListener('change', () => { save({ [key]: i.value.trim() }); if (key === 'appId') connect(); });
        return i;
      };
      const st = status.connected
        ? `<span class="status-dot ok"></span>Połączono${status.user ? ` jako <b>${esc(status.user.name)}</b>` : ''}`
        : `<span class="status-dot"></span>${esc(lastErr || 'Nie połączono')}`;
      el.replaceChildren(
        api.ui.settingRow('Status', st,
          api.ui.button(status.connected ? 'Rozłącz' : 'Połącz', { cls: 'sm', onClick: async () => {
            if (status.connected) { await api.discord.disconnect(); status = { connected: false }; draw(); } else connect();
          } })),
        api.ui.settingRow('Application ID', 'Utwórz darmową aplikację na <b>discord.com/developers/applications</b> → „New Application” i nazwij ją <b>JustMusic</b> (ta nazwa pojawi się w statusie: „Słucha JustMusic”). Skopiuj „Application ID”.',
          input('appId', 'np. 1234567890123456789'),
          api.ui.button('Otwórz', { cls: 'sm ghost', onClick: () => window.open('https://discord.com/developers/applications') })),
        S('Okładka utworu', null, 'showCover'),
        S('Pasek czasu', 'Pokazuje, ile utworu zostało.', 'showTime'),
        S('Pokazuj przy pauzie', 'Wyłącz, aby status znikał, gdy muzyka nie gra.', 'showPaused'),
        S('Przycisk „Posłuchaj”', 'Znajomi mogą otworzyć utwór na YouTube/Spotify.', 'showButton'),
        api.ui.settingRow('Status muzyki', 'To samo przełączysz szybko ikoną Discorda w odtwarzaczu.', api.ui.select([['active', '🟢 Aktywny'], ['private', '🔒 Prywatny'], ['dnd', '⛔ Nie przeszkadzać (ukryty)']], c.mode, (v) => { save({ mode: v }); push(true); paintBtn(); })),
        api.ui.settingRow('Na liście członków', 'Co znajomi widzą pod Twoim nickiem.', api.ui.select([['app', 'Słucha JustMusic'], ['song', 'Słucha <tytuł utworu>']], c.listName, (v) => { save({ listName: v }); push(true); })),
        S('Logo JustMusic', 'Mała ikona JustMusic przy okładce w statusie.', 'showLogo'),
        S('Status AFK', 'Gdy GoToSleep wykryje nieobecność, status pokaże 💤 AFK.', 'afkStatus'),
        S('Przyciszaj, gdy ktoś mówi', 'Muzyka cichnie, gdy na kanale głosowym ktoś mówi.', 'duck'),
        ...(c.duck ? [
          (() => {
            const r = h('input.range', { type: 'range', min: 0, max: 80, step: 5 });
            r.value = c.duckLevel; api.ui.rangeFill(r);
            const v = h('span', { text: c.duckLevel + '%', style: { width: '44px', textAlign: 'right' } });
            r.addEventListener('input', () => { v.textContent = r.value + '%'; api.ui.rangeFill(r); });
            r.addEventListener('change', () => save({ duckLevel: Number(r.value) }));
            return api.ui.settingRow('Głośność podczas mówienia', '0% = całkowite wyciszenie.', r, v);
          })(),
          api.ui.settingRow('Sposób wykrywania', api.system.platform === 'linux' ? '„Po dźwięku” działa z każdym klientem (Discord, Vesktop, Vencord) bez logowania.' : '„Przez Discord” wymaga oficjalnego klienta Discord i autoryzacji konta.',
            api.ui.select([['auto', 'Automatycznie'], ['audio', 'Po dźwięku (Linux)'], ['rpc', 'Przez Discord (konto)']], c.duckMethod, (v) => { save({ duckMethod: v }); toggleDuck(false, true); toggleDuck(true); draw(); })),
          ...(duckMethod() === 'audio' ? [
            (() => {
              const r = h('input.range', { type: 'range', min: 0, max: 100, step: 5 });
              r.value = c.duckSens; api.ui.rangeFill(r);
              const v = h('span', { text: c.duckSens + '%', style: { width: '44px', textAlign: 'right' } });
              r.addEventListener('input', () => { v.textContent = r.value + '%'; api.ui.rangeFill(r); api.voice.configure({ threshold: threshold(Number(r.value)) }); });
              r.addEventListener('change', () => save({ duckSens: Number(r.value) }));
              return api.ui.settingRow('Czułość', 'Wyżej = reaguje na cichsze głosy. Za wysoko = reaguje też na szum.', r, v);
            })(),
            (() => {
              const meter = h('div', { style: { position: 'relative', width: '200px', height: '10px', borderRadius: '6px', background: 'var(--hover)', overflow: 'hidden' } });
              const bar = h('i', { style: { position: 'absolute', left: '0', top: '0', bottom: '0', width: '0', background: 'var(--accent)', transition: 'width 80ms' } });
              const thr = h('i', { style: { position: 'absolute', top: '0', bottom: '0', width: '2px', background: 'var(--text)' } });
              meter.append(bar, thr);
              const scale = (x) => Math.min(100, Math.sqrt(x / 0.06) * 100); // skala zbliżona do słuchu
              meterCb = (lvl, t) => {
                if (!meter.isConnected) { meterCb = null; return; }
                bar.style.width = scale(lvl) + '%';
                bar.style.background = audioSpeaking ? 'var(--danger)' : 'var(--accent)';
                thr.style.left = scale(t) + '%';
              };
              return api.ui.settingRow('Głos na żywo', audioApps.length ? `Słucham: <b>${esc(audioApps.join(', '))}</b>` : 'Nie widzę aplikacji czatu – uruchom Discord/Vesktop i dołącz do kanału.', meter);
            })(),
          ] : [
            S('Także gdy ja mówię', null, 'duckSelf'),
            api.ui.settingRow('Client Secret', 'W aplikacji na Discord Developer Portal: OAuth2 → skopiuj „Client Secret” i dodaj Redirect <span class="code">http://127.0.0.1</span>. Sekret zostaje tylko na tym komputerze.', input('secret', '••••••••', 'password')),
          api.ui.settingRow('Konto Discord', status.voice?.authed ? `<span class="status-dot ok"></span>Autoryzowano${status.voice.channelId ? ' · nasłuch kanału głosowego' : ' · dołącz do kanału głosowego'}` : 'Po kliknięciu Discord zapyta o zgodę.',
            api.ui.button(status.voice?.authed ? 'Autoryzuj ponownie' : 'Połącz konto', { cls: 'sm', primary: !status.voice?.authed, onClick: async () => {
              const s = cfg();
              if (!s.secret) return api.ui.toast('Najpierw wpisz Client Secret', { error: true });
              try { status = await api.discord.voice({ enabled: true, secret: s.secret, interactive: true }); api.ui.toast('Połączono konto – przyciszanie aktywne'); } catch (e) { api.ui.toast('Discord: ' + (/4006|scope|authenticated/i.test(e.message) ? 'ten klient Discorda (np. Vesktop) nie obsługuje tej metody – wybierz „Po dźwięku”' : e.message), { error: true }); }
              draw();
            } })),
          ]),
        ] : []),
      );
    };
    refreshSettings = () => { if (el.isConnected) draw(); };
    draw();
  });

  function toggleDuck(v, silent = false) {
    const c = cfg();
    if (!v) {
      speaking.clear();
      audioSpeaking = false;
      if (!silent) api.player.duck(1, 500);
      api.discord.voice({ enabled: false }).catch(() => {});
      api.voice?.stop().catch(() => {});
      return;
    }
    if (duckMethod() === 'audio') {
      api.voice.start({ threshold: threshold(c.duckSens) }).then((st) => { audioApps = st.apps || []; refreshSettings(); })
        .catch((e) => api.ui.toast('Przyciszanie: ' + e.message, { error: true }));
    } else if (c.secret) api.discord.voice({ enabled: true, secret: c.secret, interactive: false }).catch(() => {});
  }

  // zdarzenia z wykrywania po dźwięku
  api.voice?.on(({ type, payload }) => {
    if (type === 'speaking') { audioSpeaking = payload.speaking; updateDuck(); }
    else if (type === 'level') meterCb?.(payload.level, payload.threshold);
    else if (type === 'apps') {
      const changed = payload.apps.join() !== audioApps.join();
      audioApps = payload.apps;
      if (changed) refreshSettings();
    }
  });
  if (cfg().duck) toggleDuck(true);

  // ---------------- mini panel w odtwarzaczu ----------------
  const svg = (d) => `<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
  const ICONS = {
    active: svg('<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>'),
    private: svg('<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>'),
    dnd: svg('<circle cx="12" cy="12" r="9"/><path d="M8 12h8"/>'),
  };
  const MODES = [
    ['active', 'Aktywny', 'Znajomi widzą, czego słuchasz'],
    ['private', 'Prywatny', 'Tylko „Słucha muzyki”, bez tytułu'],
    ['dnd', 'Nie przeszkadzać', 'Muzyka znika z Twojego profilu'],
  ];
  const playerBtn = api.ui.addPlayerButton({ id: 'panel', icon: 'discord', title: 'Discord', onClick: (e, el) => openPanel(el) });
  const paintBtn = () => {
    const c = cfg();
    playerBtn.setActive(status.connected && c.mode !== 'dnd');
    playerBtn.setTitle(`Discord: ${status.connected ? MODES.find((m) => m[0] === c.mode)?.[1] || '' : 'nie połączono'}`);
  };
  api.discord.on(() => setTimeout(paintBtn, 0));
  paintBtn();

  function openPanel(anchor) {
    const wrap = h('div.dc-panel');
    const draw = () => {
      const c = cfg();
      const t = api.player.current;
      const preview = c.mode === 'dnd' || !t ? null
        : h('div.dc-preview', null,
          h('div.dc-art', { style: t.thumb && c.showCover && c.mode !== 'private' ? { backgroundImage: `url("${t.thumb}")` } : {} }, c.showLogo ? h('img', { src: LOGO, alt: '' }) : null),
          h('div.dc-txt', { html: `<small>Słucha JustMusic</small><b>${esc(c.mode === 'private' ? 'Słucha muzyki' : t.title)}</b><span>${esc(c.mode === 'private' ? 'w JustMusic' : t.artist || '')}</span>` }));
      const head = h('div.dc-head', null,
        h('div.dc-ic', { html: api.icon('discord') }),
        h('div.dc-who', { html: `<b>Discord</b><small>${status.connected ? `<span class="status-dot ok"></span>${esc(status.user?.name || 'Połączono')}` : `<span class="status-dot"></span>${esc(lastErr || 'Nie połączono')}`}</small>` }),
        status.connected ? null : api.ui.button('Połącz', { cls: 'sm', onClick: async () => { await connect(); draw(); } }));
      const modes = h('div.dc-modes');
      for (const [k, label, hint] of MODES) {
        modes.append(h('button.dc-mode' + (c.mode === k ? '.on' : ''), {
          html: `${ICONS[k]}<span><b>${label}</b><small>${hint}</small></span>`,
          on: { click: () => { save({ mode: k }); push(true); paintBtn(); draw(); api.ui.toast(`Discord: ${label}`); } },
        }));
      }
      const row = (label, key, after) => h('label.dc-row', null, h('span', { text: label }), api.ui.switch(c[key], (v) => { save({ [key]: v }); after?.(v); push(true); draw(); }));
      wrap.replaceChildren(...[
        head,
        preview,
        h('div.dc-label', { text: 'Widoczność' }),
        modes,
        h('div.dc-label', { text: 'Szybkie opcje' }),
        h('div.dc-group', null,
          row('Okładka utworu', 'showCover'),
          row('Logo JustMusic', 'showLogo'),
          row('Pasek czasu', 'showTime'),
          row('Przycisk „Posłuchaj”', 'showButton'),
          row('Przyciszaj, gdy ktoś mówi', 'duck', (v) => toggleDuck(v))),
        h('div.dc-foot', null,
          h('span', { text: 'Status konta zmienisz w Discordzie' }),
          h('button.link', { text: 'Ustawienia', on: { click: () => { api.ui.navigate('settings', 'plugins'); document.querySelector('.popover')?.remove(); } } })),
      ].filter(Boolean));
    };
    draw();
    api.ui.popover(anchor, wrap, { align: 'right' });
  }

  // wygląd zgodny z resztą JustMusic (zmienne motywu, akcent, zaokrąglenia)
  api.ui.addStyle(`
    .dc-panel { width: 320px; display: flex; flex-direction: column; gap: 8px; }
    .dc-head { display: flex; align-items: center; gap: 12px; }
    .dc-ic { width: 40px; height: 40px; border-radius: var(--radius-sm); display: grid; place-items: center; flex: none; background: linear-gradient(135deg, var(--accent), color-mix(in srgb, var(--accent) 45%, #000)); color: var(--accent-text); }
    .dc-ic svg { width: 22px; height: 22px; }
    .dc-who { flex: 1; min-width: 0; }
    .dc-who b { display: block; font-size: 15px; }
    .dc-who small { display: flex; align-items: center; color: var(--text-dim); font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .dc-preview { display: flex; gap: 12px; align-items: center; padding: 10px; border-radius: var(--radius); background: var(--surface-2); border: 1px solid var(--border); }
    .dc-art { width: 56px; height: 56px; border-radius: var(--cover-radius); background: var(--elevated) center/cover; position: relative; flex: none; }
    .dc-art img { position: absolute; right: -5px; bottom: -5px; width: 22px; height: 22px; border-radius: 7px; border: 2px solid var(--surface-2); }
    .dc-txt { min-width: 0; display: flex; flex-direction: column; }
    .dc-txt small { font-size: 11px; color: var(--text-dim); font-weight: 700; text-transform: uppercase; letter-spacing: .06em; }
    .dc-txt b, .dc-txt span { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .dc-txt span { font-size: 12px; color: var(--text-dim); }
    .dc-label { font-size: 11px; text-transform: uppercase; letter-spacing: .08em; color: var(--text-dim); font-weight: 700; margin-top: 4px; }
    .dc-modes { display: flex; flex-direction: column; gap: 4px; }
    .dc-mode { display: flex; align-items: center; gap: 12px; padding: 9px 12px; border-radius: var(--radius-sm); border: 1px solid var(--border); background: transparent; color: var(--text); cursor: pointer; text-align: left; transition: background var(--speed), border-color var(--speed); }
    .dc-mode svg { width: 18px; height: 18px; color: var(--text-dim); flex: none; }
    .dc-mode small { display: block; color: var(--text-dim); font-size: 11px; }
    .dc-mode:hover { background: var(--hover); }
    .dc-mode.on { border-color: var(--accent); background: var(--accent-soft); }
    .dc-mode.on svg { color: var(--accent); }
    .dc-group { border: 1px solid var(--border); border-radius: var(--radius); padding: 2px 12px; background: color-mix(in srgb, var(--surface-2) 55%, transparent); }
    .dc-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; font-size: 13px; padding: 7px 0; cursor: pointer; border-bottom: 1px solid color-mix(in srgb, var(--border) 60%, transparent); }
    .dc-row:last-child { border-bottom: 0; }
    .dc-foot { display: flex; align-items: center; justify-content: space-between; font-size: 11px; color: var(--text-dim); margin-top: 2px; }
    .dc-foot .link { background: none; border: 0; color: var(--accent); font-weight: 700; cursor: pointer; font-size: 12px; }
  `);

  connect(true);
  return () => {
    clearTimeout(pushTimer);
    clearTimeout(releaseTimer);
    api.discord.setActivity(null).catch(() => {});
    api.discord.voice({ enabled: false }).catch(() => {});
    api.discord.disconnect().catch(() => {});
  };
}
