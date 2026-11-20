// Plugin: OhManyKeybinds – własne skróty klawiszowe do wszystkich poleceń aplikacji.
export default function activate(api) {
  const { h, esc } = api;
  const MOD_KEYS = new Set(['Control', 'Shift', 'Alt', 'Meta', 'AltGraph', 'OS']);
  const isMac = api.system.platform === 'darwin';

  // bindings: { [commandId]: { combo: 'Ctrl+Shift+P', global: false } }
  const getB = () => api.storage.get('bindings', {});
  const setB = (b) => { api.storage.set('bindings', b); applyGlobals(); };
  const getOpt = (k, d) => api.storage.get(k, d);

  let recording = null; // commandId

  function keyName(e) {
    if (/^Key[A-Z]$/.test(e.code)) return e.code.slice(3);
    if (/^Digit\d$/.test(e.code)) return e.code.slice(5);
    if (/^Numpad\d$/.test(e.code)) return 'Num' + e.code.slice(6);
    const map = { ' ': 'Space', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right', Escape: 'Esc' };
    if (map[e.key]) return map[e.key];
    if (/^F\d{1,2}$/.test(e.key)) return e.key;
    if (e.key.length === 1) return e.key.toUpperCase();
    return e.key; // Enter, Tab, Delete, Home, MediaPlayPause, …
  }

  function comboOf(e) {
    if (MOD_KEYS.has(e.key)) return null;
    const parts = [];
    if (e.ctrlKey) parts.push('Ctrl');
    if (e.altKey) parts.push('Alt');
    if (e.shiftKey) parts.push('Shift');
    if (e.metaKey) parts.push(isMac ? 'Cmd' : 'Super');
    parts.push(keyName(e));
    return parts.join('+');
  }

  // format akceleratora Electron (dla skrótów globalnych)
  function accelerator(combo) {
    const map = { Ctrl: 'Control', Cmd: 'Command', Super: 'Super', Esc: 'Escape', MediaPlayPause: 'MediaPlayPause', MediaTrackNext: 'MediaNextTrack', MediaTrackPrevious: 'MediaPreviousTrack', MediaStop: 'MediaStop', AudioVolumeUp: 'VolumeUp', AudioVolumeDown: 'VolumeDown', AudioVolumeMute: 'VolumeMute' };
    return combo.split('+').map((p) => map[p] || (/^Num\d$/.test(p) ? 'num' + p.slice(3) : p)).join('+');
  }

  let registered = [];
  async function applyGlobals() {
    for (const acc of registered) await api.system.unregisterGlobal(acc).catch(() => {});
    registered = [];
    const failed = [];
    for (const [id, b] of Object.entries(getB())) {
      if (!b?.combo || !b.global) continue;
      const acc = accelerator(b.combo);
      const ok = await api.system.globalShortcut(acc, id).catch(() => false);
      if (ok) registered.push(acc); else failed.push(b.combo);
    }
    if (failed.length) api.ui.toast(`Nie udało się zarejestrować skrótów globalnych: ${failed.join(', ')} (zajęte przez inny program albo nieobsługiwane)`, { error: true, duration: 6000 });
  }

  function conflicts() {
    const seen = new Map();
    const bad = new Set();
    for (const [id, b] of Object.entries(getB())) {
      if (!b?.combo) continue;
      if (seen.has(b.combo)) { bad.add(id); bad.add(seen.get(b.combo)); } else seen.set(b.combo, id);
    }
    return bad;
  }

  // przechwytywanie klawiszy (faza capture – przed domyślnymi skrótami)
  const onKey = (e) => {
    if (recording) return;
    const combo = comboOf(e);
    if (!combo) return;
    const typing = e.target.closest?.('input, textarea, select, [contenteditable]');
    const hasMod = e.ctrlKey || e.altKey || e.metaKey;
    if (typing && !hasMod) return;
    for (const [id, b] of Object.entries(getB())) {
      if (b?.combo === combo) {
        e.preventDefault();
        e.stopPropagation();
        api.commands.run(id);
        return;
      }
    }
  };
  window.addEventListener('keydown', onKey, true);
  api.onDispose(() => window.removeEventListener('keydown', onKey, true));

  // wyłączanie domyślnych skrótów
  const applyDefaults = () => api.commands.setDefaultShortcuts(!getOpt('disableDefaults', false));
  applyDefaults();

  // ---------------- widok ----------------
  function render(el) {
    let filter = '';
    const wrap = h('div.view-pad');
    el.append(wrap);
    const listBox = h('div');
    const draw = () => {
      const b = getB();
      const bad = conflicts();
      const cmds = api.commands.list().filter((c) => !filter || `${c.label} ${c.group} ${b[c.id]?.combo || ''}`.toLowerCase().includes(filter));
      const groups = new Map();
      for (const c of cmds) {
        if (!groups.has(c.group)) groups.set(c.group, []);
        groups.get(c.group).push(c);
      }
      listBox.replaceChildren();
      for (const [g, items] of groups) {
        const grp = h('div.group');
        grp.append(h('div.group-title', { text: g }));
        const box = h('div', { style: { padding: '8px 6px' } });
        for (const c of items) {
          const cur = b[c.id] || {};
          const keyBtn = h('button.kb-key' + (cur.combo ? '.set' : '') + (recording === c.id ? '.rec' : '') + (bad.has(c.id) ? '.conflict' : ''), {
            text: recording === c.id ? 'Naciśnij skrót…' : cur.combo || 'Ustaw skrót',
            title: bad.has(c.id) ? 'Konflikt – ten sam skrót ma inna akcja' : 'Kliknij i naciśnij kombinację klawiszy. Esc = anuluj, Backspace = usuń',
            on: { click: () => startRecording(c.id) },
          });
          const glob = h('label', { title: 'Skrót globalny – działa, nawet gdy okno nie jest aktywne', style: { display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: 'var(--text-dim)', cursor: 'pointer' } });
          const cb = h('input', { type: 'checkbox', checked: !!cur.global, disabled: !cur.combo });
          cb.style.accentColor = 'var(--accent)';
          cb.addEventListener('change', () => { const nb = getB(); nb[c.id] = { ...nb[c.id], global: cb.checked }; setB(nb); });
          glob.append(cb, h('span', { html: api.icon('globe'), style: { display: 'inline-flex' } }));
          const clear = api.ui.iconButton('x', 'Usuń skrót', () => { const nb = getB(); delete nb[c.id]; setB(nb); draw(); }, 'sm');
          if (!cur.combo) clear.style.visibility = 'hidden';
          box.append(h('div.kb-row', null, h('span', { text: c.label }), keyBtn, glob, clear));
        }
        grp.append(box);
        listBox.append(grp);
      }
      if (!cmds.length) listBox.append(h('div.empty', { html: `${api.icon('search')}<p>Brak akcji pasujących do „${esc(filter)}”.</p>` }));
    };

    function startRecording(id) {
      recording = id;
      draw();
      const rec = (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (e.key === 'Escape') return stop();
        if (e.key === 'Backspace' && !e.ctrlKey && !e.altKey && !e.metaKey) {
          const nb = getB(); delete nb[id]; setB(nb); return stop();
        }
        const combo = comboOf(e);
        if (!combo) return; // sam modyfikator – czekamy dalej
        const nb = getB();
        nb[id] = { ...nb[id], combo };
        setB(nb);
        stop();
      };
      const stop = () => { window.removeEventListener('keydown', rec, true); recording = null; draw(); };
      window.addEventListener('keydown', rec, true);
    }

    const search = h('input.input', { placeholder: 'Szukaj akcji lub skrótu…', style: { width: '280px' } });
    search.addEventListener('input', () => { filter = search.value.trim().toLowerCase(); draw(); });
    const defaultsSwitch = api.ui.switch(getOpt('disableDefaults', false), (v) => { api.storage.set('disableDefaults', v); applyDefaults(); });
    wrap.append(
      h('div', { style: { display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' } },
        h('h1.page-title', { text: 'Skróty klawiszowe', style: { flex: '1', margin: '0' } }), search),
      h('p.page-sub', { html: 'Kliknij pole skrótu i naciśnij kombinację klawiszy. Zaznacz 🌐, aby skrót działał globalnie – nawet gdy JustMusic jest w tle.', style: { marginTop: '6px' } }),
      h('div.group', null,
        api.ui.settingRow('Wyłącz domyślne skróty JustMusic', 'Spacja, M, L, S, R, Q itd. przestaną działać – zostaną tylko Twoje.', defaultsSwitch),
        api.ui.settingRow('Szybki start', 'Ustawia popularny zestaw: Ctrl+Alt+P/→/← (globalne) do sterowania muzyką.', api.ui.button('Wczytaj zestaw', { cls: 'sm', onClick: () => {
          const nb = { ...getB(),
            'player.toggle': { combo: 'Ctrl+Alt+P', global: true },
            'player.next': { combo: 'Ctrl+Alt+Right', global: true },
            'player.prev': { combo: 'Ctrl+Alt+Left', global: true },
            'player.volUp': { combo: 'Ctrl+Alt+Up', global: true },
            'player.volDown': { combo: 'Ctrl+Alt+Down', global: true },
            'track.like': { combo: 'Ctrl+Alt+L', global: true },
          };
          setB(nb); draw(); api.ui.toast('Wczytano zestaw skrótów');
        } }), api.ui.button('Wyczyść wszystko', { cls: 'sm ghost', onClick: async () => {
          if (await api.ui.confirm({ title: 'Usunąć wszystkie skróty?', ok: 'Usuń', danger: true })) { setB({}); draw(); }
        } })),
      ),
      listBox,
    );
    draw();
    const off = api.player.on('commands', draw); // 'commands' = zmiana listy poleceń (np. nowy plugin)
    return () => { off(); if (recording) recording = null; };
  }

  api.ui.addView({ id: 'view', title: 'Skróty', icon: 'command', render });
  api.ui.addSettings((el) => {
    el.append(api.ui.settingRow('Edytor skrótów', `${Object.keys(getB()).length} przypisanych skrótów`, api.ui.button('Otwórz', { cls: 'sm', onClick: () => api.ui.openView('view') })));
  });

  applyGlobals();
}
