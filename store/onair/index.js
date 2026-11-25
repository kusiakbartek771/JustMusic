// Plugin „OnAir” – muzyka z JustMusic na streamie (Twitch, YouTube, TikTok i inne):
// • nakładka „teraz gra” jako źródło przeglądarki / link (OBS, Streamlabs, TikTok LIVE Studio)
// • okno z jednolitym tłem do przechwycenia (gdy program nie obsługuje linków)
// • plik tekstowy „teraz gra” dla źródła „Tekst z pliku”
// • czat Twitcha: !song, prośby o piosenki (!sr) z limitami, !skip dla moderatorów

const D = {
  port: 4848,
  layout: 'card', align: 'left', anim: 'slide', accent: '', bg: '#0d0f14', text: '#ffffff', opacity: 80, radius: 18, scale: 100,
  showArt: true, showProgress: true, showLabel: true, showReq: true, shadow: true, hidePaused: false, label: 'Teraz gra',
  fileOn: false, fileFormat: '{artist} – {title}',
  winOn: false, winBg: '#00ff00',
  twitch: '', twitchAuto: true, botUser: '', botToken: '',
  cmdSong: true, cmdSr: true, srWho: 'all', srMaxMin: 8, srCooldown: 60, srMaxQueue: 5, srPerUser: 2, cmdSkip: true,
};
const LAYOUTS = [['card', 'Karta'], ['bar', 'Pasek'], ['minimal', 'Sam tekst'], ['vinyl', 'Winyl']];
const ANIMS = [['slide', 'Wysunięcie'], ['fade', 'Pojawienie się'], ['pop', 'Powiększenie'], ['none', 'Bez animacji']];
const WHO = [['all', 'Wszyscy'], ['subs', 'Subskrybenci, VIP i moderatorzy'], ['mods', 'Tylko moderatorzy i VIP']];

export default async function activate(api) {
  const { h } = api;
  if (!api.overlay) {
    api.ui.toast('OnAir wymaga JustMusic 1.8.0 – zaktualizuj aplikację (Ustawienia → O aplikacji).', { error: true, duration: 8000 });
    return;
  }
  const cfg = () => ({ ...D, ...api.storage.get('cfg', {}) });
  const save = (patch) => { api.storage.set('cfg', { ...cfg(), ...patch }); push(); };

  let server = null; // { url, port }
  let serverErr = '';
  const requests = []; // { id (track), title, user, at }
  const lastReq = new Map(); // użytkownik -> czas ostatniej prośby
  const redraws = new Set();
  const refresh = () => { for (const r of redraws) { try { r(); } catch (e) { console.error(e); } } };

  // ---------- stan dla nakładki ----------
  const accent = () => cfg().accent || getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#a78bfa';
  async function thumbOf(t) {
    if (!t?.thumb) return '';
    if (/^https:\/\//.test(t.thumb)) return t.thumb.replace('/mqdefault.jpg', '/hqdefault.jpg');
    // okładka z pliku (jm://…) – OBS jej nie otworzy, więc wysyłamy ją jako data:
    try {
      const b = await (await fetch(t.thumb)).blob();
      if (b.size > 1500000) return '';
      return await new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => res(''); r.readAsDataURL(b); });
    } catch { return ''; }
  }
  let thumbCache = { id: null, url: '' };
  async function state() {
    const c = cfg();
    const t = api.player.current;
    if (t && thumbCache.id !== t.id) thumbCache = { id: t.id, url: await thumbOf(t) };
    const req = t ? requests.find((r) => r.id === t.id && r.played) : null;
    return {
      track: t ? { title: t.title || 'Bez tytułu', artist: t.artist || '', thumb: thumbCache.url } : null,
      playing: !!api.player.playing,
      time: api.player.time || 0,
      duration: api.player.duration || 0,
      req: req?.user || null,
      cfg: {
        layout: c.layout, align: c.align, anim: c.anim, accent: accent(), bg: c.bg, text: c.text, opacity: c.opacity, radius: c.radius, scale: c.scale,
        showArt: c.showArt, showProgress: c.showProgress, showLabel: c.showLabel, showReq: c.showReq, shadow: c.shadow, hidePaused: c.hidePaused, label: c.label,
        windowBg: c.winBg,
      },
    };
  }
  let pushTimer = null;
  function push() {
    clearTimeout(pushTimer);
    pushTimer = setTimeout(async () => {
      const s = await state();
      if (server) api.overlay.push(s).catch(() => {});
      winHd?.post(s).catch(() => {});
      writeFile(s);
    }, 120);
  }

  // ---------- serwer nakładki ----------
  async function startServer() {
    try {
      server = await api.overlay.start(cfg().port);
      serverErr = '';
      push();
    } catch (e) {
      server = null;
      serverErr = e.message;
    }
    refresh();
  }

  // ---------- plik tekstowy ----------
  let filePath = '';
  let lastText = null;
  function writeFile(s) {
    const c = cfg();
    if (!c.fileOn) return;
    const t = s.track;
    const text = t ? c.fileFormat.replace(/\{title\}/g, t.title).replace(/\{artist\}/g, t.artist).replace(/\{req\}/g, s.req || '') : '';
    if (text === lastText) return;
    lastText = text;
    api.overlay.writeText('nowplaying.txt', text).then((p) => { if (p !== filePath) { filePath = p; refresh(); } }).catch(() => {});
  }

  // ---------- okno do przechwycenia ----------
  let winHd = null;
  async function syncWindow() {
    const c = cfg();
    if (!c.winOn) { winHd?.close(); winHd = null; return; }
    if (winHd || !api.widgets) return;
    try {
      winHd = await api.widgets.open('capture', { page: 'overlay.html', anchor: 'bottom-left', onTop: false, allDesktops: false, width: 520, height: 140 });
      winHd.on((ev) => {
        if (ev.type === 'message' && ev.msg?.cmd === 'ready') push();
        if (ev.type === 'closed') { winHd = null; save({ winOn: false }); refresh(); }
      });
      push();
    } catch (e) { api.ui.toast('Nie udało się otworzyć okna: ' + e.message, { error: true }); }
  }

  // ---------- czat Twitcha ----------
  const tw = { ws: null, state: 'off', channel: '', retry: 0, timer: null, canSend: false, err: '' };
  function twConnect() {
    const c = cfg();
    twClose();
    const channel = c.twitch.trim().toLowerCase().replace(/^#/, '').replace(/^.*twitch\.tv\//, '').replace(/[^a-z0-9_]/g, '');
    if (!channel) return;
    tw.channel = channel;
    tw.state = 'connecting';
    refresh();
    const token = c.botToken.trim().replace(/^oauth:/i, '');
    const user = c.botUser.trim().toLowerCase();
    const ws = new WebSocket('wss://irc-ws.chat.twitch.tv:443');
    tw.ws = ws;
    ws.onopen = () => {
      ws.send('CAP REQ :twitch.tv/tags twitch.tv/commands');
      if (token && user) { ws.send(`PASS oauth:${token}`); ws.send(`NICK ${user}`); tw.canSend = true; }
      else { ws.send(`NICK justinfan${Math.floor(10000 + Math.random() * 80000)}`); tw.canSend = false; }
      ws.send(`JOIN #${channel}`);
    };
    ws.onmessage = (e) => String(e.data).split('\r\n').filter(Boolean).forEach(onIrc);
    ws.onclose = () => {
      if (tw.ws !== ws) return;
      tw.state = 'off';
      refresh();
      clearTimeout(tw.timer);
      tw.timer = setTimeout(twConnect, Math.min(60000, 2000 * 2 ** tw.retry++));
    };
    ws.onerror = () => {};
  }
  function twClose() {
    clearTimeout(tw.timer);
    const ws = tw.ws;
    tw.ws = null;
    tw.state = 'off';
    try { ws?.close(); } catch {}
  }
  function say(text) {
    if (!tw.canSend || tw.ws?.readyState !== 1) return;
    tw.ws.send(`PRIVMSG #${tw.channel} :${text.replace(/[\r\n]+/g, ' ').slice(0, 450)}`);
  }
  function onIrc(line) {
    if (line.startsWith('PING')) { tw.ws?.send('PONG :tmi.twitch.tv'); return; }
    let tags = {};
    let rest = line;
    if (rest.startsWith('@')) {
      const i = rest.indexOf(' ');
      for (const kv of rest.slice(1, i).split(';')) { const [k, v = ''] = kv.split('='); tags[k] = v.replace(/\\s/g, ' '); }
      rest = rest.slice(i + 1);
    }
    const m = /^:(\S+?)(?:!\S+)? (\S+)(?: (\S+))?(?: :(.*))?$/.exec(rest);
    if (!m) return;
    const [, prefix, cmd, , text = ''] = m;
    if (cmd === 'JOIN' || cmd === 'ROOMSTATE' || cmd === '366') { if (tw.state !== 'on') { tw.state = 'on'; tw.retry = 0; tw.err = ''; refresh(); } return; }
    if (cmd === 'NOTICE' && /authentication failed|improperly formatted auth/i.test(text)) {
      tw.err = 'Zły token bota – czytam czat bez odpowiadania';
      api.storage.set('cfg', { ...cfg(), botToken: '' });
      refresh();
      return;
    }
    if (cmd !== 'PRIVMSG') return;
    const badges = tags.badges || '';
    const who = {
      name: tags['display-name'] || prefix,
      mod: tags.mod === '1' || /broadcaster\//.test(badges),
      broadcaster: /broadcaster\//.test(badges),
      vip: /vip\//.test(badges),
      sub: tags.subscriber === '1' || /(subscriber|founder)\//.test(badges),
    };
    onChat(who, text.trim());
  }

  async function onChat(who, text) {
    const c = cfg();
    const [word, ...args] = text.split(/\s+/);
    const cmd = word.toLowerCase();
    const t = api.player.current;
    if (c.cmdSong && (cmd === '!song' || cmd === '!piosenka' || cmd === '!utwor' || cmd === '!utwór')) {
      say(t ? `🎵 Teraz gra: ${t.artist ? t.artist + ' – ' : ''}${t.title}` : '🎵 Teraz nic nie gra');
      return;
    }
    if (c.cmdSkip && cmd === '!skip' && (who.mod || who.broadcaster)) {
      api.player.next();
      say(`⏭ ${who.name} pomija utwór`);
      return;
    }
    if (c.cmdSr && (cmd === '!sr' || cmd === '!songrequest' || cmd === '!prosba' || cmd === '!prośba')) {
      const query = args.join(' ').trim();
      if (!query) { say(`@${who.name} użyj: !sr wykonawca tytuł`); return; }
      const allowed = c.srWho === 'all' || who.mod || who.broadcaster || who.vip || (c.srWho === 'subs' && who.sub);
      if (!allowed) { say(`@${who.name} prośby są teraz tylko dla ${c.srWho === 'subs' ? 'subów i VIP' : 'moderatorów i VIP'}`); return; }
      const now = Date.now();
      const key = who.name.toLowerCase();
      if (!who.mod && !who.broadcaster) {
        const last = lastReq.get(key) || 0;
        if (now - last < c.srCooldown * 1000) { say(`@${who.name} poczekaj ${Math.ceil((c.srCooldown * 1000 - (now - last)) / 1000)} s`); return; }
        const pending = requests.filter((r) => !r.played);
        if (pending.length >= c.srMaxQueue) { say(`@${who.name} kolejka próśb jest pełna (${c.srMaxQueue})`); return; }
        if (pending.filter((r) => r.user.toLowerCase() === key).length >= c.srPerUser) { say(`@${who.name} masz już ${c.srPerUser} prośby w kolejce`); return; }
      }
      lastReq.set(key, now);
      try {
        const res = await api.library.search(query, 5);
        const pick = res.find((x) => !x.duration || x.duration <= c.srMaxMin * 60);
        if (!pick) { say(`@${who.name} nie znalazłem nic krótszego niż ${c.srMaxMin} min`); return; }
        requests.push({ id: pick.id, title: `${pick.artist ? pick.artist + ' – ' : ''}${pick.title}`, user: who.name, at: now, played: false });
        if (requests.length > 50) requests.splice(0, requests.length - 50);
        if (api.player.current) api.player.enqueue([pick], false); else api.player.play([pick]);
        say(`✅ @${who.name} dodano: ${pick.title}`);
        api.ui.toast(`Prośba od ${who.name}: ${pick.title}`);
        refresh();
      } catch (e) {
        say(`@${who.name} nie udało się wyszukać utworu`);
      }
    }
  }

  // oznacz prośbę jako graną, gdy jej utwór zacznie lecieć
  api.player.on('track', (t) => {
    const r = t && requests.find((x) => x.id === t.id && !x.played);
    if (r) r.played = true;
    push();
    refresh();
  });
  api.player.on('state', () => push());
  api.player.on('time', (() => { let last = 0; return () => { const n = Date.now(); if (n - last > 5000) { last = n; push(); } }; })());

  // ---------- widok ----------
  api.ui.addView({
    id: 'view',
    title: 'Streamowanie',
    icon: 'video',
    render(el) {
      const root = h('div.view-pad.oa');
      el.append(root);
      const draw = () => {
        if (root.contains(document.activeElement) && document.activeElement.matches('input[type=text], input:not([type]), textarea')) return;
        root.replaceChildren(...view());
      };
      redraws.add(draw);
      draw();
      return () => redraws.delete(draw);
    },
  });

  const copy = (text, msg) => navigator.clipboard.writeText(text).then(() => api.ui.toast(msg || 'Skopiowano'));
  const row = (label, hint, ...ctl) => api.ui.settingRow(label, hint, ...ctl);
  const sw = (k, after) => api.ui.switch(cfg()[k], (v) => { save({ [k]: v }); after?.(v); refresh(); });
  const sel = (k, opts, after) => api.ui.select(opts, cfg()[k], (v) => { save({ [k]: v }); after?.(v); refresh(); });
  const num = (k, min, max, after) => {
    const i = h('input.input', { type: 'number', min, max, value: cfg()[k], style: { width: '90px' } });
    i.addEventListener('change', () => { const v = Math.max(min, Math.min(max, Math.round(Number(i.value) || 0))); i.value = v; save({ [k]: v }); after?.(v); });
    return i;
  };
  const txt = (k, ph, after, type = 'text') => {
    const i = h('input.input', { type, value: cfg()[k], placeholder: ph || '', spellcheck: false });
    i.addEventListener('change', () => { save({ [k]: i.value.trim() }); after?.(i.value.trim()); refresh(); });
    return i;
  };
  const color = (k) => {
    const i = h('input', { type: 'color', value: cfg()[k] || '#a78bfa', className: 'oa-color' });
    i.addEventListener('input', () => save({ [k]: i.value }));
    return i;
  };

  let tab = 'obs';
  const GUIDES = {
    obs: ['OBS / Streamlabs', [
      'Kliknij „+” w Źródłach → „Przeglądarka” (Browser Source).',
      'Wklej adres nakładki w pole URL, ustaw szerokość 800 i wysokość 220.',
      'Zaznacz „Odśwież przeglądarkę, gdy scena staje się aktywna”. Gotowe – nakładka zmienia się sama.',
    ]],
    tiktok: ['TikTok LIVE Studio', [
      'Dodaj źródło → „Link” (w nowszych wersjach) i wklej adres nakładki.',
      'Jeśli nakładka się nie pojawia: włącz „Okno do przechwycenia” niżej i dodaj źródło „Przechwytywanie okna” z oknem „JustMusic widget onair/capture”.',
      'Zielone tło usuniesz filtrem „Chroma key” (albo ustaw kolor tła okna na przezroczysty, jeśli program to obsługuje).',
    ]],
    youtube: ['YouTube', [
      'YouTube Studio nie ma własnych nakładek – streamuj przez OBS lub Streamlabs i dodaj nakładkę jak w OBS.',
      'Z telefonu: użyj aplikacji typu Streamlabs Mobile – też obsługuje „Przeglądarkę” z adresem nakładki.',
    ]],
    twitch: ['Twitch', [
      'Nakładkę dodaj w OBS / Streamlabs / Twitch Studio jako „Przeglądarka”.',
      'Niżej wpisz nazwę kanału – widzowie mogą wtedy pisać !song i prosić o utwory przez !sr.',
      'Uwaga na prawa autorskie: na Twitchu i YouTube muzyka z wytwórni może skończyć się wyciszeniem lub ostrzeżeniem DMCA.',
    ]],
  };

  function view() {
    const c = cfg();
    const url = server ? server.url + 'overlay.html' : '';
    const guide = GUIDES[tab];
    const pending = requests.filter((r) => !r.played);
    const twState = tw.state === 'on' ? (tw.canSend ? 'połączono – bot odpowiada na czacie' : 'połączono – tylko czytam czat (bez tokenu bota)') : tw.state === 'connecting' ? 'łączenie…' : c.twitch ? 'rozłączono' : 'wyłączone';
    return [
      h('h1.page-title', { text: 'Streamowanie' }),
      h('p.page-sub', { text: 'Pokaż widzom, co teraz gra, i pozwól im prosić o piosenki – na Twitchu, YouTube, TikToku i wszędzie, gdzie streamujesz.' }),

      h('div.oa-card.oa-main', null,
        h('div.oa-l', null,
          h('span.oa-eye', { text: 'Adres nakładki' }),
          server ? h('code.oa-url', { text: url }) : h('span.oa-err', { text: serverErr || 'Uruchamianie…' }),
          h('small.muted', { text: 'Dodaj go jako źródło „Przeglądarka” / „Link” w programie do streamowania.' })),
        h('div.oa-r', null,
          server ? api.ui.button('Kopiuj adres', { primary: true, icon: 'copy', onClick: () => copy(url, 'Skopiowano adres nakładki') }) : api.ui.button('Spróbuj ponownie', { icon: 'refresh', onClick: startServer }),
          server ? api.ui.button('Podgląd', { icon: 'external', onClick: () => window.jm.shell.external(url) }) : null)),

      h('div.oa-tabs', null, ...Object.entries(GUIDES).map(([k, [label]]) => h('button.oa-tab' + (k === tab ? '.on' : ''), { text: label, on: { click: () => { tab = k; refresh(); } } }))),
      h('ol.oa-guide', null, ...guide[1].map((s) => h('li', { text: s }))),

      h('h2.oa-h', { text: 'Wygląd nakładki' }),
      h('div.oa-sec', null,
        row('Układ', null, sel('layout', LAYOUTS)),
        row('Wyrównanie', 'Po której stronie źródła ma stać nakładka.', sel('align', [['left', 'Do lewej'], ['center', 'Na środku'], ['right', 'Do prawej']])),
        row('Animacja', 'Przy zmianie utworu.', sel('anim', ANIMS)),
        row('Kolory', 'Akcent (puste = jak w aplikacji), tło i tekst.', color('accent'), color('bg'), color('text')),
        row('Przezroczystość tła', null, num('opacity', 0, 100), h('span.muted', { text: '%' })),
        row('Rozmiar', null, num('scale', 50, 250), h('span.muted', { text: '%' })),
        row('Zaokrąglenie', null, num('radius', 0, 40), h('span.muted', { text: 'px' })),
        row('Napis nad tytułem', null, txt('label', 'Teraz gra')),
        row('Okładka', null, sw('showArt')),
        row('Pasek postępu', null, sw('showProgress')),
        row('Napis „Teraz gra”', null, sw('showLabel')),
        row('Kto poprosił o utwór', 'Pokazuje „Prośba od: nick” przy utworach z !sr.', sw('showReq')),
        row('Cień', null, sw('shadow')),
        row('Ukryj podczas pauzy', null, sw('hidePaused')),
        row('Port serwera', 'Zmień, jeśli 4848 jest zajęty. Adres nakładki też się zmieni.', num('port', 1024, 65535, () => startServer()))),

      h('h2.oa-h', { text: 'Inne sposoby' }),
      h('div.oa-sec', null,
        row('Okno do przechwycenia', 'Osobne okno z nakładką na jednolitym tle – dla programów bez źródła „Link” (dodaj „Przechwytywanie okna”).', sw('winOn', () => syncWindow())),
        row('Tło okna', 'Zielone najłatwiej usunąć filtrem „Chroma key”.', color('winBg')),
        row('Plik tekstowy', filePath ? `Zapisywany do: ${filePath}` : 'Plik „nowplaying.txt” dla źródła „Tekst” → „Czytaj z pliku”.', sw('fileOn', (v) => { lastText = null; if (v) push(); })),
        row('Format pliku', '{artist}, {title}, {req} (kto poprosił).', txt('fileFormat', '{artist} – {title}', () => { lastText = null; push(); })),
        filePath ? row('Folder pliku', null, api.ui.button('Pokaż', { cls: 'sm', onClick: () => window.jm.shell.show(filePath) })) : null),

      h('h2.oa-h', { text: 'Czat Twitcha' }),
      h('div.oa-sec', null,
        row('Kanał', 'Twoja nazwa na Twitchu albo link do kanału.', txt('twitch', 'np. mojkanal', () => twConnect())),
        row('Stan', null, h('span.oa-st' + (tw.state === 'on' ? '.on' : ''), { text: tw.err || twState })),
        row('Konto bota (opcjonalnie)', 'Żeby bot odpowiadał na czacie: nazwa konta i token OAuth z uprawnieniem do pisania na czacie (chat:edit). Bez tego komendy działają, ale bez odpowiedzi.', txt('botUser', 'nazwa konta'), txt('botToken', 'oauth:…', () => twConnect(), 'password')),
        row('!song', 'Bot podaje, co teraz gra.', sw('cmdSong')),
        row('!sr – prośby o piosenki', 'Widz pisze np. „!sr dawid podsiadło małomiasteczkowy” – utwór trafia do kolejki.', sw('cmdSr')),
        row('Kto może prosić', null, sel('srWho', WHO)),
        row('Maksymalna długość utworu', null, num('srMaxMin', 1, 60), h('span.muted', { text: 'min' })),
        row('Przerwa między prośbami jednej osoby', null, num('srCooldown', 0, 3600), h('span.muted', { text: 's' })),
        row('Limit próśb w kolejce', 'Łącznie / na osobę. Moderatorów limity nie dotyczą.', num('srMaxQueue', 1, 50), num('srPerUser', 1, 20)),
        row('!skip dla moderatorów', null, sw('cmdSkip'))),
      h('p.muted.oa-note', { text: 'YouTube i TikTok nie udostępniają czatu bez kluczy API, więc komendy działają na razie na Twitchu. Nakładka i plik tekstowy działają wszędzie.' }),

      h('h2.oa-h', { text: `Prośby widzów (${pending.length})` }),
      pending.length ? h('div.oa-reqs', null, ...pending.map((r) => h('div.oa-req', null,
        h('b', { text: r.title }), h('span.muted', { text: r.user }),
        api.ui.iconButton('x', 'Usuń z listy', () => { requests.splice(requests.indexOf(r), 1); refresh(); }, 'sm'))))
        : h('p.muted', { text: 'Brak oczekujących próśb.' }),
    ].filter(Boolean);
  }

  api.ui.addStyle(`
    .oa { max-width: 980px; }
    .oa-card { display: flex; align-items: center; justify-content: space-between; gap: 16px; flex-wrap: wrap; padding: 18px 20px; border-radius: var(--radius-lg, var(--radius)); border: 1px solid var(--border); background: var(--surface-2); margin: 10px 0 14px; }
    .oa-main { background: linear-gradient(140deg, color-mix(in srgb, var(--accent) 24%, var(--surface-2)), var(--surface-2) 75%); border-color: color-mix(in srgb, var(--accent) 35%, var(--border)); }
    .oa-l { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
    .oa-r { display: flex; gap: 8px; flex-wrap: wrap; }
    .oa-eye { font-size: 11px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; color: var(--text-dim); }
    .oa-url { font-size: 17px; font-weight: 700; user-select: all; word-break: break-all; }
    .oa-err { color: var(--danger); font-weight: 600; }
    .oa-tabs { display: flex; gap: 6px; flex-wrap: wrap; margin: 4px 0 8px; }
    .oa-tab { border: 1px solid var(--border); background: var(--surface-2); color: var(--text); padding: 7px 14px; border-radius: 99px; cursor: pointer; font: inherit; font-size: 13px; }
    .oa-tab.on { background: var(--accent); color: var(--accent-text); border-color: var(--accent); }
    .oa-guide { margin: 0 0 8px; padding: 10px 14px 10px 32px; border-radius: var(--radius); background: color-mix(in srgb, var(--surface-2) 55%, transparent); border: 1px solid var(--border); display: grid; gap: 6px; font-size: 13px; line-height: 1.5; }
    .oa-h { font-size: 17px; margin: 22px 0 8px; }
    .oa-sec { border: 1px solid var(--border); border-radius: var(--radius); padding: 2px 16px; background: color-mix(in srgb, var(--surface-2) 55%, transparent); }
    .oa-sec .input { max-width: 220px; }
    .oa-color { width: 34px; height: 28px; border: 1px solid var(--border); border-radius: 6px; background: none; padding: 1px; cursor: pointer; }
    .oa-st { font-size: 13px; color: var(--text-dim); display: inline-flex; align-items: center; gap: 6px; }
    .oa-st::before { content: ''; width: 8px; height: 8px; border-radius: 50%; background: var(--text-dim); }
    .oa-st.on::before { background: var(--success, #3c9); }
    .oa-note { font-size: 12px; margin: 8px 2px; }
    .oa-reqs { display: grid; gap: 6px; }
    .oa-req { display: flex; align-items: center; gap: 10px; padding: 8px 12px; border-radius: var(--radius-sm, 8px); background: var(--surface-2); border: 1px solid var(--border); }
    .oa-req b { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-size: 13px; }
    .oa-req span { font-size: 12px; }
  `);

  api.commands.register({ id: 'copyurl', label: 'OnAir: kopiuj adres nakładki', run: () => (server ? copy(server.url + 'overlay.html', 'Skopiowano adres nakładki') : api.ui.toast(serverErr || 'Serwer nakładki nie działa', { error: true })) });

  await startServer();
  syncWindow();
  if (cfg().twitch && cfg().twitchAuto) twConnect();
  push();

  return () => { twClose(); winHd?.close(); clearTimeout(pushTimer); };
}
