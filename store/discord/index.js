// Plugin: Discord – status „Słucha …” (Rich Presence) + przyciszanie, gdy ktoś mówi.
export default function activate(api) {
  const { h, esc } = api;
  const D = {
    appId: '', secret: '', showCover: true, showTime: true, showPaused: true, showButton: true,
    privacy: false, mode: 'active', duck: false, duckLevel: 25, duckSelf: false, afkStatus: true,
  };
  const cfg = () => ({ ...D, ...api.storage.get('cfg', {}) });
  const save = (patch) => api.storage.set('cfg', { ...cfg(), ...patch });

  let status = { connected: false, user: null, voice: {} };
  let lastErr = '';
  let afk = !!api.bus.last('afk');
  const speaking = new Set();
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
    const a = { type: 2, status_display_type: 2, instance: false };
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
      if (c.duck && c.secret) api.discord.voice({ enabled: true, secret: c.secret, interactive: false }).catch((e) => { lastErr = e.message === 'AUTH_REQUIRED' ? 'Kliknij „Połącz konto”, aby włączyć przyciszanie' : e.message; refreshSettings(); });
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
    if (c.duck && speaking.size) api.player.duck(c.duckLevel / 100, 250);
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
        S('Status AFK', 'Gdy GoToSleep wykryje nieobecność, status pokaże 💤 AFK.', 'afkStatus'),
        S('Przyciszaj, gdy ktoś mówi', 'Na kanale głosowym, na którym jesteś. Wymaga jednorazowej autoryzacji konta.', 'duck'),
        ...(c.duck ? [
          (() => {
            const r = h('input.range', { type: 'range', min: 0, max: 80, step: 5 });
            r.value = c.duckLevel; api.ui.rangeFill(r);
            const v = h('span', { text: c.duckLevel + '%', style: { width: '44px', textAlign: 'right' } });
            r.addEventListener('input', () => { v.textContent = r.value + '%'; api.ui.rangeFill(r); });
            r.addEventListener('change', () => save({ duckLevel: Number(r.value) }));
            return api.ui.settingRow('Głośność podczas mówienia', '0% = całkowite wyciszenie.', r, v);
          })(),
          S('Także gdy ja mówię', null, 'duckSelf'),
          api.ui.settingRow('Client Secret', 'W aplikacji na Discord Developer Portal: OAuth2 → skopiuj „Client Secret” i dodaj Redirect <span class="code">http://127.0.0.1</span>. Sekret zostaje tylko na tym komputerze.', input('secret', '••••••••', 'password')),
          api.ui.settingRow('Konto Discord', status.voice?.authed ? `<span class="status-dot ok"></span>Autoryzowano${status.voice.channelId ? ' · nasłuch kanału głosowego' : ' · dołącz do kanału głosowego'}` : 'Po kliknięciu Discord zapyta o zgodę.',
            api.ui.button(status.voice?.authed ? 'Autoryzuj ponownie' : 'Połącz konto', { cls: 'sm', primary: !status.voice?.authed, onClick: async () => {
              const s = cfg();
              if (!s.secret) return api.ui.toast('Najpierw wpisz Client Secret', { error: true });
              try { status = await api.discord.voice({ enabled: true, secret: s.secret, interactive: true }); api.ui.toast('Połączono konto – przyciszanie aktywne'); } catch (e) { api.ui.toast('Discord: ' + e.message, { error: true }); }
              draw();
            } })),
        ] : []),
      );
    };
    refreshSettings = () => { if (el.isConnected) draw(); };
    draw();
  });

  function toggleDuck(v) {
    const c = cfg();
    if (!v) { speaking.clear(); api.player.duck(1, 500); api.discord.voice({ enabled: false }).catch(() => {}); }
    else if (c.secret) api.discord.voice({ enabled: true, secret: c.secret, interactive: false }).catch(() => {});
  }

  // ---------------- mini panel w odtwarzaczu ----------------
  const MODES = [
    ['active', '🟢', 'Aktywny', 'Znajomi widzą, czego słuchasz'],
    ['private', '🔒', 'Prywatny', 'Tylko „Słucha muzyki” – bez tytułu'],
    ['dnd', '⛔', 'Nie przeszkadzać', 'Ukrywa muzykę na Discordzie'],
  ];
  const playerBtn = api.ui.addPlayerButton({ id: 'panel', icon: 'discord', title: 'Discord', onClick: (e, el) => openPanel(el) });
  const paintBtn = () => {
    const c = cfg();
    playerBtn.setActive(status.connected && c.mode !== 'dnd');
    playerBtn.setTitle(`Discord: ${status.connected ? MODES.find((m) => m[0] === c.mode)?.[2] || '' : 'nie połączono'}`);
  };
  api.discord.on(() => setTimeout(paintBtn, 0));
  paintBtn();

  function openPanel(anchor) {
    const wrap = h('div.dc-panel');
    const draw = () => {
      const c = cfg();
      const head = h('div.dc-head', { html: `${api.icon('discord')}<div><b>Discord</b><small>${status.connected ? `<span class="status-dot ok"></span>${esc(status.user?.name || 'Połączono')}` : `<span class="status-dot"></span>${esc(lastErr || 'Nie połączono')}`}</small></div>` });
      if (!status.connected) head.append(api.ui.button('Połącz', { cls: 'sm', onClick: async () => { await connect(); draw(); } }));
      const modes = h('div.dc-modes');
      for (const [k, emoji, label, hint] of MODES) {
        modes.append(h('button.dc-mode' + (c.mode === k ? '.on' : ''), {
          html: `<span class="e">${emoji}</span><span><b>${label}</b><small>${hint}</small></span>`,
          on: { click: () => { save({ mode: k }); push(true); paintBtn(); draw(); } },
        }));
      }
      const quick = (label, key, after) => h('label.dc-toggle', null, h('span', { text: label }), api.ui.switch(c[key], (v) => { save({ [key]: v }); after?.(v); push(true); draw(); }));
      wrap.replaceChildren(
        head,
        h('div.dc-label', { text: 'Status muzyki' }),
        modes,
        h('div.dc-label', { text: 'Szybkie opcje' }),
        quick('Okładka', 'showCover'),
        quick('Pasek czasu', 'showTime'),
        quick('Przycisk „Posłuchaj”', 'showButton'),
        quick('Przyciszaj, gdy ktoś mówi', 'duck', (v) => toggleDuck(v)),
        h('p.dc-note', { text: 'Status konta (Dostępny / Zaraz wracam / Nie przeszkadzać) zmienisz tylko w samym Discordzie – Discord nie pozwala aplikacjom go zmieniać.' }),
        h('button.dc-more', { text: 'Wszystkie ustawienia →', on: { click: () => { api.ui.navigate('settings', 'plugins'); document.querySelector('.popover')?.remove(); } } }),
      );
    };
    draw();
    api.ui.popover(anchor, wrap, { align: 'right' });
  }

  api.ui.addStyle(`
    .dc-panel { width: 300px; display: flex; flex-direction: column; gap: 6px; }
    .dc-head { display: flex; align-items: center; gap: 10px; margin-bottom: 4px; }
    .dc-head > svg { width: 26px; height: 26px; color: #5865f2; flex: none; }
    .dc-head > div { flex: 1; min-width: 0; }
    .dc-head small { display: block; color: var(--text-dim); font-size: 12px; }
    .dc-label { font-size: 11px; text-transform: uppercase; letter-spacing: .08em; color: var(--text-dim); font-weight: 700; margin-top: 8px; }
    .dc-modes { display: flex; flex-direction: column; gap: 4px; }
    .dc-mode { display: flex; align-items: center; gap: 10px; padding: 8px 10px; border-radius: var(--radius-sm); border: 1px solid transparent; background: var(--surface-2); cursor: pointer; text-align: left; transition: all var(--speed); }
    .dc-mode:hover { border-color: color-mix(in srgb, var(--text) 20%, transparent); }
    .dc-mode.on { border-color: var(--accent); background: var(--accent-soft); }
    .dc-mode .e { font-size: 18px; }
    .dc-mode small { display: block; color: var(--text-dim); font-size: 11px; }
    .dc-toggle { display: flex; align-items: center; justify-content: space-between; gap: 10px; font-size: 13px; padding: 4px 2px; cursor: pointer; }
    .dc-note { font-size: 11px; color: var(--text-dim); margin: 6px 0 0; line-height: 1.4; }
    .dc-more { background: none; border: 0; color: var(--accent); font-weight: 600; cursor: pointer; text-align: left; padding: 4px 0 0; }
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
