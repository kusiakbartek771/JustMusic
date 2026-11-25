// Plugin: CanWeListenTogether – wspólne słuchanie w czasie rzeczywistym.
// Gospodarz gra muzykę, goście słyszą to samo w tym samym momencie (każdy odtwarza u siebie,
// synchronizowane są tylko tytuł, pozycja i pauza). Bez kont i bez własnego serwera.
import { Room, BROKERS, newCode, normCode, randomId } from './room.js';
import { FriendsNet } from './friends.js';

const REACTIONS = ['🔥', '❤️', '😂', '👏', '🎉', '😴'];
const LAT = 0.05;          // przybliżone opóźnienie dostarczenia wiadomości (s)
const HEARTBEAT = 4000;    // gospodarz ogłasza stan co tyle ms
const MEMBER_TTL = 45000;  // gość bez sygnału dłużej niż tyle – znika z listy

export default function activate(api) {
  const { h, esc } = api;
  const D = { nick: '', control: false, add: true, discord: true, showCode: false, brokers: '', share: true, shareRoom: true };
  const cfg = () => ({ ...D, ...api.storage.get('cfg', {}) });
  const save = (patch) => api.storage.set('cfg', { ...cfg(), ...patch });

  const myId = randomId(10);
  let S = null;        // bieżąca sesja
  let me = '';
  const redraws = new Set();
  let onRoomChange = () => {};
  const refresh = () => { for (const r of redraws) { try { r(); } catch (e) { console.error(e); } } updateChip(); emitBus(); onRoomChange(); };

  // ---------- pomocnicze ----------
  async function myName() {
    const n = cfg().nick.trim();
    if (n) return n.slice(0, 32);
    try { const s = await api.discord.status(); if (s?.user?.name) return s.user.name.slice(0, 32); } catch {}
    return 'Słuchacz ' + (100 + Math.floor(Math.random() * 900));
  }
  const brokers = () => cfg().brokers.split(/\s+/).filter((u) => /^wss?:\/\//.test(u));
  const hue = (s) => [...String(s)].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7) % 360;
  const ytThumb = (id) => `https://i.ytimg.com/vi/${id}/mqdefault.jpg`;
  let applyingUntil = 0;
  const applying = (ms = 1500) => { applyingUntil = Math.max(applyingUntil, Date.now() + ms); };
  const isApplying = () => Date.now() < applyingUntil;
  let loading = false;
  api.player.on('loading', (v) => { loading = !!v; if (S?.role === 'host') broadcast(); });
  // „gra” dopiero, gdy dźwięk naprawdę leci (nie podczas buforowania) – inaczej goście wyprzedzają gospodarza
  const reallyPlaying = () => api.player.playing && !loading && api.player.audio.readyState >= 3;
  const isAfk = () => !!api.bus.last('afk');

  // ---------- gospodarz: utwór w formie zrozumiałej dla gości ----------
  const resolved = new Map(); // id lokalnego pliku → ytId | null | 'pending'
  function shareTrack(t) {
    if (!t) return null;
    const base = { title: t.title || 'Bez tytułu', artist: t.artist || '', album: t.album || '', duration: t.duration || 0, thumb: /^https:\/\//.test(t.thumb || '') ? t.thumb : '' };
    if (t.ytId) return { ...base, id: 'yt:' + t.ytId, source: 'youtube', ytId: t.ytId, thumb: base.thumb || ytThumb(t.ytId) };
    if (t.source === 'spotify' && t.spotifyId) return { ...base, id: t.id, source: 'spotify', spotifyId: t.spotifyId };
    // lokalny plik – goście znajdą go na YouTube
    const r = resolved.get(t.id);
    if (typeof r === 'string' && r !== 'pending') return { ...base, id: 'yt:' + r, source: 'youtube', ytId: r, thumb: ytThumb(r) };
    if (r === null) return { ...base, id: 'none:' + t.id, source: 'none' };
    if (r === undefined) {
      resolved.set(t.id, 'pending');
      window.jm.yt.resolve({ title: t.title, artist: t.artist, duration: t.duration })
        .then((id) => resolved.set(t.id, id || null))
        .catch(() => resolved.set(t.id, null))
        .finally(() => S?.role === 'host' && broadcast(true));
    }
    return { ...base, id: 'pending:' + t.id, source: 'pending' };
  }

  function hostState() {
    const t = api.player.current;
    const q = api.player.queue;
    const i = t ? q.findIndex((x) => x.id === t.id) : -1;
    const c = cfg();
    return {
      k: 'state', name: me, at: Date.now(),
      track: shareTrack(t), playing: reallyPlaying(), pos: api.player.time,
      next: i >= 0 ? q.slice(i + 1, i + 6).map((x) => ({ title: x.title, artist: x.artist || '' })) : [],
      members: [{ id: myId, name: me, st: 'host' }, ...[...S.members.values()].map((m) => ({ id: m.id, name: m.name, st: m.st }))],
      ctl: { control: !!c.control, add: !!c.add },
    };
  }

  let bcTimer = null;
  function broadcast(now = false) {
    if (S?.role !== 'host') return;
    clearTimeout(bcTimer);
    bcTimer = setTimeout(() => { if (S?.role === 'host') S.room.send('s', hostState(), true); }, now ? 0 : 120);
  }

  // ---------- gość: dopasowanie do gospodarza ----------
  function expected() {
    const st = S.hs;
    let p = st.pos + (st.playing ? (Date.now() - S.recvAt) / 1000 + LAT : 0);
    const d = api.player.duration;
    if (d && Number.isFinite(d)) p = Math.min(p, d - 0.3);
    return Math.max(0, p);
  }
  const onHostTrack = () => S?.trackKey && api.player.current?.id === S.trackKey;

  function applyTrack() {
    if (S?.role !== 'guest' || !S.hs || S.detached) return;
    const tr = S.hs.track;
    if (!tr || tr.source === 'pending') return;
    if (tr.source === 'none') {
      if (api.player.playing) { applying(); api.player.pause(); }
      return;
    }
    if (S.trackKey === tr.id && api.player.current?.id === tr.id) return;
    S.trackKey = tr.id;
    applying(5000);
    const { source, ...rest } = tr;
    api.player.play([{ ...rest, source }]);
  }

  function syncTick() {
    if (S?.role !== 'guest' || !S.hs || S.detached) return;
    const a = api.player.audio;
    if (!onHostTrack()) { applyTrack(); return; }
    if (loading || a.readyState < 3) return;
    const exp = expected();
    if (S.hs.playing && a.paused && !a.ended) { applying(); a.currentTime = exp; api.player.resume(); return; }
    if (!S.hs.playing) {
      a.playbackRate = 1;
      if (!a.paused) { applying(); api.player.pause(); }
      if (Math.abs(a.currentTime - exp) > 0.2) { applying(); api.player.seek(exp); }
      return;
    }
    // duża różnica → przeskok; mała → delikatne przyspieszenie/zwolnienie (bez zmiany wysokości dźwięku)
    const drift = a.currentTime - exp;
    if (Math.abs(drift) > 1.2) { applying(2500); a.playbackRate = 1; api.player.seek(exp + 0.1); S.correcting = true; }
    else if (Math.abs(drift) > (S.correcting ? 0.03 : 0.12)) { S.correcting = true; a.playbackRate = Math.max(0.93, Math.min(1.07, 1 - drift * 0.35)); }
    else { S.correcting = false; a.playbackRate = 1; }
  }

  // gość sam coś zmienił w odtwarzaczu
  function userAction(action, arg) {
    if (S?.role !== 'guest' || S.detached || !S.hs) return;
    if (action === 'pause' && isAfk()) { detach('Jesteś AFK – muzyka zatrzymana tylko u Ciebie'); return; }
    if (S.hs.ctl?.control) {
      if (action === 'track') {
        const t = shareTrack(arg);
        if (!t || t.source === 'none' || t.source === 'pending') { detach('Ten utwór jest tylko na Twoim dysku – słuchasz go po swojemu'); return; }
        sendCmd('track', { track: t });
        S.trackKey = arg.id === t.id ? t.id : S.trackKey;
      } else sendCmd(action, action === 'seek' ? { pos: arg } : {});
      return;
    }
    detach('Sterowanie ma tylko gospodarz – słuchasz teraz po swojemu');
  }

  function detach(msg) {
    if (!S || S.detached) return;
    S.detached = true;
    api.player.audio.playbackRate = 1;
    api.ui.toast(msg, { duration: 7000, action: { label: 'Wróć', onClick: resync } });
    ping();
    refresh();
  }
  function resync() {
    if (S?.role !== 'guest') return;
    S.detached = false;
    S.trackKey = null;
    applyTrack();
    ping();
    refresh();
  }

  api.player.on('track', (t) => {
    if (S?.role === 'host') { broadcast(); refresh(); return; }
    if (S?.role === 'guest' && !isApplying() && t && t.id !== S.trackKey) userAction('track', t);
    refresh();
  });
  api.player.on('state', () => {
    if (S?.role === 'host') { broadcast(); refresh(); return; }
    if (S?.role !== 'guest' || isApplying() || loading || !onHostTrack() || !S.hs) return;
    const a = api.player.audio;
    if (a.readyState < 3) return;
    const nearEnd = (api.player.duration || 0) - a.currentTime < 3 || a.currentTime < 0.5;
    if (a.paused && S.hs.playing && !a.ended && !nearEnd) userAction('pause');
    else if (!a.paused && !S.hs.playing) userAction('play');
  });
  let lastT = 0;
  api.player.on('time', () => {
    const t = api.player.time;
    if (S?.role === 'host' && Math.abs(t - lastT) > 2.5) broadcast();
    lastT = t;
  });
  const onSeeked = () => {
    if (S?.role !== 'guest' || isApplying() || !onHostTrack() || !S.hs) return;
    if (Math.abs(api.player.audio.currentTime - expected()) > 3) userAction('seek', api.player.audio.currentTime);
  };
  api.player.audio.addEventListener('seeked', onSeeked);
  api.onDispose(() => api.player.audio.removeEventListener('seeked', onSeeked));

  // ---------- wiadomości ----------
  function sendCmd(a, extra = {}) {
    S?.room.send('e', { k: 'cmd', a, name: me, ...extra });
  }
  function ping() {
    if (S?.role !== 'guest') return;
    const st = S.detached ? 'own' : isAfk() ? 'afk' : loading ? 'loading' : 'sync';
    S.room.send('e', { k: S.helloSent ? 'ping' : 'hello', name: me, st });
    S.helloSent = true;
  }

  function onMessage(chan, m, retained) {
    if (!S) return;
    if (m.k === 'react') { showReaction(m.e, m.name); return; }

    if (S.role === 'host') {
      if (chan !== 'e') return;
      const known = S.members.get(m.from);
      if (m.k === 'hello' || m.k === 'ping') {
        S.members.set(m.from, { id: m.from, name: String(m.name || 'Gość').slice(0, 32), st: m.st || 'sync', last: Date.now() });
        if (!known) { api.ui.toast(`${m.name} dołącza do słuchania 🎧`); broadcast(true); }
        else if (known.st !== m.st || known.name !== m.name) broadcast();
        refresh();
      } else if (m.k === 'bye') {
        if (known) { S.members.delete(m.from); api.ui.toast(`${known.name} opuszcza pokój`); broadcast(); refresh(); }
      } else if (m.k === 'cmd') hostCommand(m);
      return;
    }

    // gość
    if (m.k === 'end' && (chan === 's' || m.from === S.hostId || !S.hostId)) {
      const msg = !S.found ? 'Ten pokój jest już zamknięty' : m.lost ? 'Gospodarz rozłączył się – wspólne słuchanie zakończone' : 'Gospodarz zakończył wspólne słuchanie';
      leave(false, msg);
      return;
    }
    if (m.k === 'deny' && m.to === myId) { api.ui.toast(m.msg || 'Gospodarz nie pozwala na to gościom'); return; }
    if (chan === 's' && m.k === 'state') {
      if (S.hs && m.at < S.hs.at) return; // starszy stan (np. zapamiętany na innym serwerze)
      const first = !S.found;
      S.hostId = m.from;
      S.found = true;
      S.hs = m;
      S.recvAt = Date.now() - (retained ? 1000 : 0);
      if (first) { clearTimeout(S.joinTimer); api.ui.toast(`Słuchasz razem z: ${m.name} 🎧`); ping(); }
      if (!retained) S.lastHeard = Date.now();
      applyTrack();
      syncTick();
      refresh();
    }
  }

  function hostCommand(m) {
    const c = cfg();
    const who = String(m.name || 'Gość').slice(0, 32);
    const deny = (msg) => S.room.send('e', { k: 'deny', to: m.from, msg });
    const ctlOnly = ['toggle', 'pause', 'play', 'next', 'prev', 'seek', 'track'];
    if (ctlOnly.includes(m.a) && !c.control) { deny('Sterowanie ma tylko gospodarz'); return; }
    if (m.a === 'add' && !(c.add || c.control)) { deny('Gospodarz nie pozwala dodawać utworów'); return; }
    const toTrack = (t) => t && typeof t.title === 'string' && (t.ytId || t.spotifyId) && { ...t, id: t.ytId ? 'yt:' + t.ytId : t.id };
    switch (m.a) {
      case 'pause': api.player.pause(); api.ui.toast(`${who} zatrzymuje ⏸`); break;
      case 'play': api.player.resume(); api.ui.toast(`${who} wznawia ▶`); break;
      case 'toggle': api.player.toggle(); break;
      case 'next': api.player.next(); api.ui.toast(`${who} przełącza dalej ⏭`); break;
      case 'prev': api.player.prev(); break;
      case 'seek': if (Number.isFinite(m.pos)) api.player.seek(m.pos); break;
      case 'track': {
        const t = toTrack(m.track);
        if (!t) return;
        api.player.enqueue([t], true);
        api.player.next();
        api.ui.toast(`${who} włącza: ${t.title}`);
        break;
      }
      case 'add': {
        const list = (Array.isArray(m.tracks) ? m.tracks : [m.track]).map(toTrack).filter(Boolean).slice(0, 25);
        if (!list.length) return;
        api.player.enqueue(list, false);
        api.ui.toast(list.length === 1 ? `${who} dodaje: ${list[0].title}` : `${who} dodaje ${list.length} utworów`);
        broadcast();
        break;
      }
    }
  }

  // ---------- sesja ----------
  async function start(role, code) {
    if (S) await leave(true);
    me = await myName();
    const sess = {
      role, code, members: new Map(), hs: null, found: role === 'host', detached: false, trackKey: null,
      links: 0, startedAt: Date.now(), timers: [],
    };
    S = sess;
    refresh();
    try {
      sess.room = await Room.open({
        code, id: myId, role, brokers: brokers(),
        onMessage: (chan, m, r) => { if (S === sess) onMessage(chan, m, r); },
        onLinks: (n, up) => {
          if (S !== sess) return;
          sess.links = n;
          if (up) { if (role === 'host') broadcast(true); else { sess.helloSent = false; ping(); } }
          refresh();
        },
      });
    } catch (e) {
      S = null;
      api.ui.toast('Nie udało się uruchomić wspólnego słuchania: ' + e.message, { error: true });
      refresh();
      return false;
    }
    if (role === 'host') {
      sess.timers.push(setInterval(() => broadcast(true), HEARTBEAT));
      sess.timers.push(setInterval(() => {
        let changed = false;
        for (const [id, m] of sess.members) if (Date.now() - m.last > MEMBER_TTL) { sess.members.delete(id); changed = true; api.ui.toast(`${m.name} stracił(a) połączenie`); }
        if (changed) { broadcast(); refresh(); }
      }, 5000));
    } else {
      sess.timers.push(setInterval(syncTick, 500));
      sess.timers.push(setInterval(ping, 10000));
      sess.joinTimer = setTimeout(() => {
        if (S !== sess || sess.found) return;
        leave(true, sess.links ? `Nie znaleziono pokoju ${code} – sprawdź kod albo poproś o nowy` : 'Brak połączenia z serwerami synchronizacji – sprawdź internet');
      }, 12000);
    }
    refresh();
    return true;
  }

  async function host() {
    const ok = await start('host', newCode());
    if (ok) { api.ui.toast('Pokój gotowy – wyślij znajomym kod 🎉'); api.ui.openView('room'); }
  }

  async function join(input) {
    const code = normCode(input);
    if (!code) { api.ui.toast('Kod ma 8 znaków, np. ABCD-EFGH', { error: true }); return; }
    await start('guest', code);
    api.ui.openView('room');
  }

  async function leave(notify = true, msg = '') {
    const sess = S;
    if (!sess) return;
    S = null;
    clearTimeout(bcTimer);
    clearTimeout(sess.joinTimer);
    for (const t of sess.timers) clearInterval(t);
    api.player.audio.playbackRate = 1;
    if (sess.room) {
      if (notify) {
        if (sess.role === 'host') { await sess.room.send('e', { k: 'end' }); sess.room.clearRetained(); }
        else await sess.room.send('e', { k: 'bye' });
      }
      setTimeout(() => sess.room.close(), 300);
    }
    if (msg) api.ui.toast(msg, { duration: 6000 });
    refresh();
  }

  function invite() {
    if (!S) return;
    const text = `🎧 Posłuchaj ze mną w JustMusic!\nOtwórz „CanWeListenTogether” i wpisz kod: ${S.code}`;
    navigator.clipboard.writeText(text).then(() => api.ui.toast('Skopiowano zaproszenie – wklej je znajomym')).catch(() => api.ui.toast('Kod: ' + S.code));
  }

  function react(e) {
    if (!S) return;
    S.room.send('e', { k: 'react', e, name: me });
    showReaction(e, 'Ty');
  }

  // latające emoji nad odtwarzaczem
  function showReaction(e, name) {
    if (!REACTIONS.includes(e)) return;
    const el = h('div.tg-float', null, h('span.tg-float-e', { text: e }), h('span.tg-float-n', { text: name }));
    el.style.left = 55 + Math.random() * 35 + '%';
    document.body.append(el);
    setTimeout(() => el.remove(), 2600);
  }

  // ---------- integracje ----------
  const chip = api.ui.addTitlebarItem({ id: 'room', icon: 'user', text: 'Razem', title: 'CanWeListenTogether', onClick: () => api.ui.openView('room') });
  chip.show(false);
  function count() { return S ? (S.role === 'host' ? S.members.size + 1 : S.hs?.members?.length || 1) : 0; }
  function updateChip() {
    chip.show(!!S);
    if (!S) return;
    const label = S.role === 'guest' && !S.found ? 'Łączenie…' : S.detached ? 'Razem · po swojemu' : `Razem · ${count()}`;
    chip.set({ text: label, title: `CanWeListenTogether – pokój ${S.code}` });
  }
  let lastBus = '';
  function emitBus() {
    const c = cfg();
    const v = S && c.discord && (S.role === 'host' || S.found)
      ? { active: true, role: S.role, count: count(), code: c.showCode ? S.code : null, party: S.code.replace('-', '') }
      : { active: false };
    const key = JSON.stringify(v);
    if (key !== lastBus) { lastBus = key; api.bus.emit('together', v); }
  }

  api.commands.register({ id: 'create', label: 'CanWeListenTogether: utwórz pokój', run: () => host() });
  api.commands.register({ id: 'join', label: 'CanWeListenTogether: dołącz do pokoju', run: async () => { const c = await api.ui.prompt({ title: 'Dołącz do pokoju', text: 'Wpisz kod od znajomego.', placeholder: 'ABCD-EFGH', ok: 'Dołącz' }); if (c) join(c); } });
  api.commands.register({ id: 'invite', label: 'CanWeListenTogether: skopiuj zaproszenie', run: () => invite() });
  api.commands.register({ id: 'leave', label: 'CanWeListenTogether: wyjdź z pokoju', run: () => leave(true) });

  api.ui.addTrackMenuItem({
    label: 'Dodaj do wspólnego słuchania',
    icon: 'user',
    onClick: (tracks) => {
      if (!S) { api.ui.toast('Najpierw utwórz pokój albo dołącz do znajomych (CanWeListenTogether)'); return; }
      if (S.role === 'host') { api.player.enqueue(tracks, false); api.ui.toast(tracks.length === 1 ? 'Dodano do kolejki' : `Dodano ${tracks.length} utworów`); return; }
      const ctl = S.hs?.ctl || {};
      if (!ctl.add && !ctl.control) { api.ui.toast('Gospodarz nie pozwala dodawać utworów'); return; }
      const list = tracks.map(shareTrack).filter((t) => t && t.source !== 'none' && t.source !== 'pending');
      if (!list.length) { api.ui.toast('Pliki z dysku trzeba najpierw znaleźć na YouTube – spróbuj za chwilę'); return; }
      sendCmd('add', { tracks: list });
      api.ui.toast(list.length === 1 ? `Wysłano do gospodarza: ${list[0].title}` : `Wysłano ${list.length} utworów`);
    },
  });

  // ---------- widok ----------
  api.ui.addView({
    id: 'room',
    title: 'CanWeListenTogether',
    icon: 'user',
    render(el) {
      const root = h('div.view-pad.tg');
      el.append(root);
      const draw = () => {
        const focusCode = root.querySelector('.tg-code-in') === document.activeElement;
        root.replaceChildren(h('h1.page-title', { text: 'CanWeListenTogether' }), ...(S ? roomView() : lobbyView()));
        if (focusCode) root.querySelector('.tg-code-in')?.focus();
      };
      redraws.add(draw);
      draw();
      const tick = setInterval(() => { if (S) updateNow(root); }, 1000);
      return () => { redraws.delete(draw); clearInterval(tick); };
    },
  });

  function lobbyView() {
    const c = cfg();
    const code = h('input.input.tg-code-in', { placeholder: 'ABCD-EFGH', maxlength: 32, spellcheck: false, autocomplete: 'off' });
    code.addEventListener('input', () => {
      const raw = code.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
      code.value = raw.length > 4 ? raw.slice(0, 4) + '-' + raw.slice(4) : raw;
    });
    code.addEventListener('keydown', (e) => { if (e.key === 'Enter') join(code.value); });
    const nick = h('input.input', { value: c.nick, placeholder: 'np. Bartek (domyślnie nazwa z Discorda)', maxlength: 32 });
    nick.addEventListener('change', () => save({ nick: nick.value.trim() }));
    return [
      h('p.page-sub', { text: 'Ty wybierasz muzykę, a znajomi słyszą dokładnie to samo w tym samym momencie – jak wspólny głośnik, tylko przez internet.' }),
      h('div.tg-cards', null,
        h('div.tg-card.tg-card-main', null,
          h('div.tg-card-ic', { html: api.icon('user') }),
          h('b', { text: 'Utwórz pokój' }),
          h('p', { text: 'Dostaniesz kod, który wyślesz znajomym. Ty sterujesz muzyką.' }),
          api.ui.button('Utwórz pokój', { primary: true, icon: 'plus', onClick: () => host() })),
        h('div.tg-card', null,
          h('div.tg-card-ic', { html: api.icon('link') }),
          h('b', { text: 'Dołącz do znajomych' }),
          h('p', { text: 'Wpisz kod pokoju, który od kogoś dostałeś.' }),
          h('div.tg-join', null, code, api.ui.button('Dołącz', { primary: true, onClick: () => join(code.value) })))),
      h('div.tg-section', null,
        api.ui.settingRow('Twoja nazwa', 'Tak zobaczą Cię inni w pokoju.', nick)),
      h('div.tg-how', null,
        how('1', 'Każdy gra u siebie', 'Przez internet leci tylko informacja, co gra i w którym miejscu – muzyka nie traci jakości, a internet się nie męczy.'),
        how('2', 'Działa z każdym źródłem', 'YouTube, Spotify i pliki z dysku – utwory, których goście nie mają, są automatycznie znajdowane na YouTube.'),
        how('3', 'Prywatnie', 'Bez kont. Wiadomości są szyfrowane kodem pokoju, więc nikt bez kodu ich nie odczyta.')),
    ];
  }
  const how = (n, t, d) => h('div.tg-how-i', null, h('span.tg-how-n', { text: n }), h('div', null, h('b', { text: t }), h('small', { text: d })));

  function avatar(name, id) {
    return h('span.tg-av', { text: (name || '?').trim().charAt(0).toUpperCase(), style: { background: `hsl(${hue(id || name)} 55% 46%)` } });
  }
  const ST = { host: 'gospodarz', sync: 'słucha', loading: 'wczytuje…', own: 'słucha po swojemu', afk: '💤 AFK' };

  function roomView() {
    const c = cfg();
    const isHost = S.role === 'host';
    const waiting = !isHost && !S.found;
    const links = S.links;
    const total = (brokers().length || BROKERS.length);
    const conn = h('span.tg-conn' + (links ? '.on' : ''), { text: links ? `Połączono (${links}/${total})` : 'Łączenie…', title: 'Serwery synchronizacji' });

    const head = h('div.tg-head', null,
      h('div.tg-head-l', null,
        h('small.tg-eyebrow', { text: isHost ? 'Twój pokój' : waiting ? 'Szukam pokoju…' : `Pokój: ${S.hs?.name || ''}` }),
        h('div.tg-code', null, h('span', { text: S.code }), api.ui.iconButton('copy', 'Kopiuj kod', () => navigator.clipboard.writeText(S.code).then(() => api.ui.toast('Skopiowano kod')), 'sm')),
        conn),
      h('div.tg-head-r', null,
        api.ui.button('Zaproś', { icon: 'link', primary: true, onClick: invite }),
        api.ui.button(isHost ? 'Zakończ' : 'Wyjdź', { icon: 'x', cls: 'tg-leave', onClick: () => leave(true) })));

    const out = [head];
    if (waiting) {
      out.push(h('div.tg-wait', null, h('div.tg-spin'), h('span', { text: 'Łączę się z pokojem – gospodarz musi mieć włączone JustMusic.' })));
      return out;
    }
    if (S.detached) out.push(h('div.tg-banner', null, h('span', { text: 'Słuchasz teraz po swojemu – reszta pokoju gra dalej.' }), api.ui.button('Wróć do wspólnego słuchania', { cls: 'sm', icon: 'refresh', onClick: resync })));

    // co gra
    const t = isHost ? shareTrack(api.player.current) : S.hs?.track;
    const playing = isHost ? reallyPlaying() : S.hs?.playing;
    const now = h('div.tg-now', null,
      h('div.tg-art', { style: t?.thumb ? { backgroundImage: `url("${t.thumb}")` } : {} }, t?.thumb ? null : h('span', { html: api.icon('music') })),
      h('div.tg-now-t', null,
        h('small', { text: playing ? 'Teraz gra' : t ? 'Wstrzymano' : 'Cisza' }),
        h('b', { text: t ? t.title : isHost ? 'Włącz dowolny utwór – goście usłyszą go razem z Tobą' : 'Gospodarz jeszcze nic nie włączył' }),
        h('span', { text: t ? t.artist || '' : '' }),
        t?.source === 'none' ? h('span.tg-warn', { text: 'Tego pliku nie znaleziono na YouTube – goście go nie usłyszą' }) : null,
        t?.source === 'pending' ? h('span.tg-warn', { text: 'Szukam tego pliku na YouTube dla gości…' }) : null),
      h('div.tg-time', { dataset: { tg: 'time' } }));
    out.push(now);

    const next = isHost ? hostState().next : S.hs?.next || [];
    const cols = h('div.tg-cols');
    const members = isHost ? [{ id: myId, name: me, st: 'host' }, ...S.members.values()] : S.hs?.members || [];
    cols.append(h('div.tg-box', null,
      h('div.tg-label', { text: `Słuchają (${members.length})` }),
      ...members.map((m) => h('div.tg-member', null, avatar(m.name, m.id),
        h('b', { text: m.name + (m.id === myId ? ' (Ty)' : '') }),
        h('small.tg-st.' + (m.st || 'sync'), { text: ST[m.st] || ST.sync }))),
      members.length < 2 ? h('div.tg-empty', { text: isHost ? 'Nikogo jeszcze nie ma – kliknij „Zaproś” i wyślij kod znajomym.' : '' }) : null));
    cols.append(h('div.tg-box', null,
      h('div.tg-label', { text: 'Następne w kolejce' }),
      ...(next.length ? next.map((x, i) => h('div.tg-next', null, h('span.tg-n', { text: String(i + 1) }), h('div', null, h('b', { text: x.title }), h('small', { text: x.artist })))) : [h('div.tg-empty', { text: 'Kolejka gospodarza jest pusta.' })]),
      !isHost && (S.hs?.ctl?.add || S.hs?.ctl?.control) ? h('div.tg-hint', { text: 'Możesz dodać utwór: kliknij go prawym przyciskiem → „Dodaj do wspólnego słuchania”.' }) : null));
    out.push(cols);

    out.push(h('div.tg-reacts', null, h('span.tg-label', { text: 'Reakcje' }), ...REACTIONS.map((e) => h('button.tg-react', { text: e, title: 'Wyślij wszystkim', on: { click: () => react(e) } }))));

    if (isHost) {
      out.push(h('div.tg-section', null,
        api.ui.settingRow('Goście mogą sterować', 'Pauza, przewijanie i zmiana utworu przez gości.', api.ui.switch(c.control, (v) => { save({ control: v }); broadcast(true); })),
        api.ui.settingRow('Goście mogą dodawać utwory', 'Utwory od gości trafiają na koniec Twojej kolejki.', api.ui.switch(c.add, (v) => { save({ add: v }); broadcast(true); }))));
    } else {
      const ctl = S.hs?.ctl || {};
      out.push(h('div.tg-hint', { text: ctl.control ? 'Gospodarz pozwala sterować – pauza i przełączanie działają u wszystkich.' : 'Muzyką steruje gospodarz. Jeśli coś zmienisz u siebie, będziesz słuchać po swojemu, dopóki nie wrócisz.' }));
    }
    return out;
  }

  function updateNow(root) {
    const el = root.querySelector('[data-tg="time"]');
    if (!el) return;
    let pos, dur;
    if (S.role === 'host') { pos = api.player.time; dur = api.player.duration; }
    else if (S.hs?.track) { pos = expected(); dur = S.hs.track.duration || api.player.duration; }
    el.textContent = pos != null ? `${api.fmtTime(pos)}${dur ? ' / ' + api.fmtTime(dur) : ''}` : '';
  }

  // ---------- ustawienia ----------
  api.ui.addSettings((el) => {
    const c = cfg();
    const nick = h('input.input', { value: c.nick, placeholder: 'domyślnie nazwa z Discorda', maxlength: 32 });
    nick.addEventListener('change', () => save({ nick: nick.value.trim() }));
    const br = h('textarea.input', { rows: 3, placeholder: BROKERS.join('\n'), style: { width: '100%', fontFamily: 'monospace', fontSize: '12px' } });
    br.value = c.brokers;
    br.addEventListener('change', () => save({ brokers: br.value.trim() }));
    el.append(
      api.ui.settingRow('Twoja nazwa', null, nick),
      api.ui.settingRow('Goście mogą sterować', 'Gdy jesteś gospodarzem.', api.ui.switch(c.control, (v) => { save({ control: v }); broadcast(true); })),
      api.ui.settingRow('Goście mogą dodawać utwory', null, api.ui.switch(c.add, (v) => { save({ add: v }); broadcast(true); })),
      api.ui.settingRow('Pokazuj na Discordzie', 'Z pluginem Discord: „Słuchamy razem (3)” w statusie.', api.ui.switch(c.discord, (v) => { save({ discord: v }); emitBus(); })),
      api.ui.settingRow('Kod pokoju w statusie Discord', 'Znajomi mogą dołączyć, przepisując kod z Twojego profilu.', api.ui.switch(c.showCode, (v) => { save({ showCode: v }); emitBus(); })),
      api.ui.settingRow('Serwery synchronizacji', 'Dla zaawansowanych: własne brokery MQTT (wss://…), po jednym w linii. Wszyscy w pokoju muszą mieć te same. Puste = domyślne publiczne.', br),
    );
  });

  api.ui.addStyle(`
    .tg { max-width: 980px; }
    .tg-cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 14px; margin-bottom: 18px; }
    .tg-card { display: flex; flex-direction: column; gap: 8px; align-items: flex-start; padding: 20px; border-radius: var(--radius-lg, var(--radius)); background: var(--surface-2); border: 1px solid var(--border); }
    .tg-card-main { background: linear-gradient(140deg, color-mix(in srgb, var(--accent) 26%, var(--surface-2)), var(--surface-2) 70%); border-color: color-mix(in srgb, var(--accent) 40%, var(--border)); }
    .tg-card b { font-size: 17px; }
    .tg-card p { margin: 0 0 6px; color: var(--text-dim); font-size: 13px; flex: 1; }
    .tg-card-ic { width: 42px; height: 42px; border-radius: var(--radius-sm); display: grid; place-items: center; background: var(--accent); color: var(--accent-text); }
    .tg-card-ic svg { width: 22px; height: 22px; }
    .tg-join { display: flex; gap: 8px; width: 100%; }
    .tg-join .input { flex: 1; min-width: 0; font-family: ui-monospace, monospace; letter-spacing: .12em; text-transform: uppercase; font-size: 15px; }
    .tg-section { border: 1px solid var(--border); border-radius: var(--radius); padding: 2px 16px; margin: 14px 0; background: color-mix(in srgb, var(--surface-2) 55%, transparent); }
    .tg-how { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px; margin-top: 8px; }
    .tg-how-i { display: flex; gap: 12px; align-items: flex-start; padding: 12px; }
    .tg-how-i b { display: block; margin-bottom: 2px; }
    .tg-how-i small { color: var(--text-dim); font-size: 12px; line-height: 1.45; }
    .tg-how-n { flex: none; width: 26px; height: 26px; border-radius: 50%; display: grid; place-items: center; font-weight: 800; font-size: 13px; background: var(--accent-soft); color: var(--accent); }
    .tg-head { display: flex; align-items: center; justify-content: space-between; gap: 16px; flex-wrap: wrap; padding: 18px 20px; border-radius: var(--radius-lg, var(--radius)); background: linear-gradient(140deg, color-mix(in srgb, var(--accent) 24%, var(--surface-2)), var(--surface-2) 75%); border: 1px solid color-mix(in srgb, var(--accent) 35%, var(--border)); margin: 10px 0 14px; }
    .tg-head-l { display: flex; flex-direction: column; gap: 4px; }
    .tg-head-r { display: flex; gap: 8px; }
    .tg-eyebrow { font-size: 11px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; color: var(--text-dim); }
    .tg-code { display: flex; align-items: center; gap: 6px; }
    .tg-code span { font-family: ui-monospace, monospace; font-size: 30px; font-weight: 800; letter-spacing: .12em; }
    .tg-conn { font-size: 12px; color: var(--text-dim); display: inline-flex; align-items: center; gap: 6px; }
    .tg-conn::before { content: ''; width: 8px; height: 8px; border-radius: 50%; background: var(--text-dim); }
    .tg-conn.on::before { background: var(--success, #3c9); box-shadow: 0 0 0 3px color-mix(in srgb, var(--success, #3c9) 25%, transparent); }
    .tg-leave:hover { color: var(--danger); border-color: var(--danger); }
    .tg-wait { display: flex; align-items: center; gap: 12px; padding: 18px; color: var(--text-dim); }
    .tg-spin { width: 20px; height: 20px; border-radius: 50%; border: 3px solid var(--border); border-top-color: var(--accent); animation: tg-spin 0.9s linear infinite; }
    @keyframes tg-spin { to { transform: rotate(360deg); } }
    .tg-banner { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; padding: 10px 14px; border-radius: var(--radius); background: var(--accent-soft); border: 1px solid var(--accent); margin-bottom: 14px; font-size: 13px; }
    .tg-now { display: flex; align-items: center; gap: 16px; padding: 14px; border-radius: var(--radius); background: var(--surface-2); border: 1px solid var(--border); margin-bottom: 14px; }
    .tg-art { width: 72px; height: 72px; border-radius: var(--cover-radius, var(--radius-sm)); background: var(--elevated) center/cover; flex: none; display: grid; place-items: center; color: var(--text-dim); }
    .tg-art svg { width: 28px; height: 28px; }
    .tg-now-t { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
    .tg-now-t small { font-size: 11px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; color: var(--accent); }
    .tg-now-t b { font-size: 16px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .tg-now-t span { color: var(--text-dim); font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .tg-now-t .tg-warn { color: var(--danger); font-size: 12px; }
    .tg-time { font-variant-numeric: tabular-nums; color: var(--text-dim); font-size: 13px; }
    .tg-cols { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 14px; }
    .tg-box { padding: 12px 14px; border-radius: var(--radius); border: 1px solid var(--border); background: color-mix(in srgb, var(--surface-2) 55%, transparent); display: flex; flex-direction: column; gap: 4px; }
    .tg-label { font-size: 11px; text-transform: uppercase; letter-spacing: .08em; color: var(--text-dim); font-weight: 700; margin-bottom: 4px; }
    .tg-member { display: flex; align-items: center; gap: 10px; padding: 5px 0; }
    .tg-member b { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-size: 14px; }
    .tg-av { width: 30px; height: 30px; border-radius: 50%; display: grid; place-items: center; color: #fff; font-weight: 800; font-size: 13px; flex: none; }
    .tg-st { font-size: 11px; padding: 2px 8px; border-radius: 99px; background: var(--hover); color: var(--text-dim); white-space: nowrap; }
    .tg-st.host { background: var(--accent-soft); color: var(--accent); font-weight: 700; }
    .tg-st.sync { color: var(--success, var(--text-dim)); }
    .tg-next { display: flex; align-items: center; gap: 10px; padding: 4px 0; min-width: 0; }
    .tg-next div { min-width: 0; display: flex; flex-direction: column; }
    .tg-next b, .tg-next small { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .tg-next b { font-size: 13px; font-weight: 600; }
    .tg-next small { color: var(--text-dim); font-size: 12px; }
    .tg-n { width: 18px; text-align: center; color: var(--text-dim); font-size: 12px; flex: none; }
    .tg-empty, .tg-hint { color: var(--text-dim); font-size: 12px; padding: 4px 0; }
    .tg-hint { margin-top: 8px; }
    .tg-reacts { display: flex; align-items: center; gap: 6px; margin: 14px 0 0; flex-wrap: wrap; }
    .tg-reacts .tg-label { margin: 0 8px 0 0; }
    .tg-react { font-size: 20px; width: 42px; height: 42px; border-radius: 50%; border: 1px solid var(--border); background: var(--surface-2); cursor: pointer; transition: transform var(--speed), background var(--speed); }
    .tg-react:hover { transform: translateY(-2px) scale(1.08); background: var(--hover); }
    .tg-react:active { transform: scale(.92); }
    .tg-float { position: fixed; bottom: calc(var(--player-h, 90px) + 10px); z-index: 9999; pointer-events: none; display: flex; flex-direction: column; align-items: center; animation: tg-up 2.6s cubic-bezier(.2,.7,.3,1) forwards; }
    .tg-float-e { font-size: 40px; filter: drop-shadow(0 4px 10px rgb(0 0 0 / .35)); }
    .tg-float-n { font-size: 11px; font-weight: 700; padding: 2px 8px; border-radius: 99px; background: var(--elevated); color: var(--text); box-shadow: var(--shadow); }
    @keyframes tg-up { 0% { transform: translateY(20px) scale(.6); opacity: 0; } 15% { transform: translateY(0) scale(1.1); opacity: 1; } 75% { opacity: 1; } 100% { transform: translateY(-220px) scale(1); opacity: 0; } }
  `);

  // ================= ZNAJOMI: co teraz słuchają =================
  let myCode = api.storage.get('friendCode', null);
  if (!myCode) { myCode = newCode(); api.storage.set('friendCode', myCode); }
  const friends = () => api.storage.get('friends', []);
  const setFriends = (list) => api.storage.set('friends', list);
  const statuses = new Map(); // kod -> { st, seen }
  let net = null;
  let netOpening = null;
  const friendRedraws = new Set();
  const fRefresh = () => { for (const r of friendRedraws) { try { r(); } catch (e) { console.error(e); } } updateFriendsChip(); };

  // łączymy się tylko, gdy to ma sens: masz znajomych albo komuś dałeś swój kod
  const wantNet = () => friends().length > 0 || api.storage.get('codeShared', false);
  async function ensureNet() {
    if (net || netOpening || !wantNet()) return net;
    netOpening = FriendsNet.open({
      id: myId, code: myCode, brokers: brokers(),
      onStatus: (code, st) => { statuses.set(code, { st, seen: Date.now() }); fRefresh(); },
    }).then(async (n) => {
      net = n;
      for (const f of friends()) await n.follow(f.code);
      publishMe(true);
      return n;
    }).catch((e) => { console.error('[friends]', e); return null; }).finally(() => { netOpening = null; });
    return netOpening;
  }

  async function myStatus() {
    const c = cfg();
    if (!c.share) return { off: true, hidden: true };
    const t = api.player.current;
    const tr = t ? shareTrack(t) : null;
    return {
      name: await myName(),
      playing: !!api.player.playing,
      track: tr ? { ...tr, ...(tr.source === 'pending' || tr.source === 'none' ? { source: 'info' } : {}) } : null,
      room: S?.role === 'host' && c.shareRoom ? S.code : null,
      afk: isAfk(),
    };
  }
  let pubTimer = null;
  let lastPub = '';
  function publishMe(now = false) {
    clearTimeout(pubTimer);
    pubTimer = setTimeout(async () => {
      if (!net) return;
      const st = await myStatus();
      const key = JSON.stringify(st);
      // co 2 min odświeżamy, żeby znajomi wiedzieli, że wciąż jesteś
      if (key === lastPub && !now) return;
      lastPub = key;
      net.publish(st);
    }, now ? 0 : 1500);
  }
  const heartbeat = setInterval(() => { if (net) publishMe(true); }, 120000);
  onRoomChange = () => publishMe();
  api.player.on('track', () => publishMe());
  api.player.on('state', () => publishMe());

  async function addFriend(input, name = '') {
    const code = normCode(input);
    if (!code) { api.ui.toast('Kod znajomego ma 8 znaków, np. ABCD-EFGH', { error: true }); return false; }
    if (code === myCode) { api.ui.toast('To Twój własny kod 🙂'); return false; }
    if (friends().some((f) => f.code === code)) { api.ui.toast('Ten znajomy już jest na liście'); return false; }
    setFriends([...friends(), { code, name: name.trim().slice(0, 32), added: Date.now() }]);
    await ensureNet();
    await net?.follow(code);
    api.ui.toast('Dodano znajomego – za chwilę zobaczysz, czego słucha');
    fRefresh();
    return true;
  }
  async function removeFriend(code) {
    setFriends(friends().filter((f) => f.code !== code));
    statuses.delete(code);
    await net?.unfollow(code);
    fRefresh();
  }
  function copyMyCode() {
    api.storage.set('codeShared', true);
    ensureNet();
    const text = `Dodaj mnie w JustMusic (CanWeListenTogether → Znajomi): ${myCode}`;
    navigator.clipboard.writeText(text).then(() => api.ui.toast('Skopiowano Twój kod znajomego')).catch(() => api.ui.toast('Twój kod: ' + myCode));
  }

  const ONLINE_MS = 5 * 60e3;
  function friendState(code) {
    const s = statuses.get(code)?.st;
    if (!s || s.off || Date.now() - (s.at || 0) > ONLINE_MS) return { online: false, s };
    return { online: true, s };
  }
  function listenToo(s) {
    const tr = s?.track;
    if (!tr || tr.source === 'info' || !tr.source) { if (tr) api.ui.navigate('search', { q: `${tr.artist} ${tr.title}`.trim() }); return; }
    const { source, ...rest } = tr;
    api.player.play([{ ...rest, source }]);
    api.ui.toast(`Słuchasz tego samego co ${s.name || 'znajomy'} 🎧`);
  }

  const fchip = api.ui.addTitlebarItem({ id: 'friends', icon: 'user', text: '', title: 'Znajomi – kto teraz słucha', onClick: () => api.ui.openView('friends') });
  function updateFriendsChip() {
    const n = friends().filter((f) => { const x = friendState(f.code); return x.online && x.s?.playing; }).length;
    fchip.set({ text: n ? `${n} ${n === 1 ? 'znajomy słucha' : 'znajomych słucha'}` : '' });
    fchip.show(n > 0);
  }
  updateFriendsChip();

  function friendsView() {
    const list = friends();
    const c = cfg();
    const add = h('input.input.tg-code-in', { placeholder: 'Kod znajomego, np. ABCD-EFGH', maxlength: 64, spellcheck: false, autocomplete: 'off' });
    const nm = h('input.input', { placeholder: 'Nazwa (opcjonalnie)', maxlength: 32 });
    const doAdd = async () => { if (await addFriend(add.value, nm.value)) { add.value = ''; nm.value = ''; } };
    add.addEventListener('keydown', (e) => { if (e.key === 'Enter') doAdd(); });
    const rows = list.map((f) => {
      const { online, s } = friendState(f.code);
      const name = f.name || s?.name || 'Znajomy';
      const tr = online ? s?.track : null;
      const status = !s ? 'czekam na połączenie…' : s.hidden ? 'ukrywa, czego słucha' : !online ? 'offline' : s.afk ? '💤 AFK' : tr ? (s.playing ? 'słucha teraz' : 'pauza') : 'nic nie gra';
      return h('div.fr-row' + (online && s?.playing ? '.live' : ''), null,
        avatar(name, f.code),
        h('div.fr-main', null,
          h('b', { text: name }),
          h('small', { text: status }),
          tr ? h('div.fr-track', null,
            tr.thumb ? h('span.fr-art', { style: { backgroundImage: `url("${String(tr.thumb).replace(/"/g, '%22')}")` } }) : null,
            h('span', { text: `${tr.title}${tr.artist ? ' – ' + tr.artist : ''}` })) : null),
        h('div.fr-actions', null,
          tr ? api.ui.button('Posłuchaj też', { cls: 'sm', icon: 'play', onClick: () => listenToo(s) }) : null,
          online && s?.room && !S ? api.ui.button('Dołącz', { cls: 'sm', primary: true, icon: 'user', onClick: () => join(s.room) }) : null,
          api.ui.iconButton('edit', 'Zmień nazwę', async () => {
            const v = await api.ui.prompt({ title: 'Nazwa znajomego', value: f.name || s?.name || '', ok: 'Zapisz' });
            if (v === null || v === undefined) return;
            setFriends(friends().map((x) => (x.code === f.code ? { ...x, name: String(v).trim().slice(0, 32) } : x)));
            fRefresh();
          }, 'sm'),
          api.ui.iconButton('x', 'Usuń znajomego', async () => {
            if (await api.ui.confirm({ title: `Usunąć ${name}?`, ok: 'Usuń', danger: true })) removeFriend(f.code);
          }, 'sm')));
    });
    return [
      h('p.page-sub', { text: 'Zobacz, czego słuchają znajomi, włącz to samo albo dołącz do ich pokoju.' }),
      h('div.tg-head', null,
        h('div.tg-head-l', null,
          h('span.tg-eyebrow', { text: 'Twój kod znajomego' }),
          h('div.tg-code', null, h('span', { text: myCode }), api.ui.iconButton('copy', 'Kopiuj', copyMyCode, 'sm')),
          h('span.tg-conn' + (net?.links ? '.on' : ''), { text: net?.links ? 'połączono' : wantNet() ? 'łączenie…' : 'wyślij komuś kod albo dodaj znajomego' })),
        h('div.tg-head-r', null, api.ui.button('Wyślij kod znajomym', { icon: 'link', primary: true, onClick: copyMyCode }))),
      h('div.tg-join.fr-add', null, add, nm, api.ui.button('Dodaj', { primary: true, icon: 'plus', onClick: doAdd })),
      list.length ? h('div.fr-list', null, ...rows) : h('div.tg-empty', { text: 'Nie masz jeszcze znajomych. Poproś kogoś o jego kod znajomego albo wyślij mu swój.' }),
      h('div.tg-section', null,
        api.ui.settingRow('Pokazuj znajomym, czego słucham', 'Wyłączone = znajomi widzą tylko „ukrywa, czego słucha”.', api.ui.switch(c.share, (v) => { save({ share: v }); publishMe(true); })),
        api.ui.settingRow('Pozwól dołączać do mojego pokoju', 'Gdy tworzysz pokój, znajomi zobaczą przycisk „Dołącz”.', api.ui.switch(c.shareRoom, (v) => { save({ shareRoom: v }); publishMe(true); }))),
      h('p.tg-hint', { text: 'Twój kod działa jak hasło: kto go zna, widzi, czego słuchasz. Status jest szyfrowany tym kodem i przechodzi przez publiczne serwery tak jak pokoje.' }),
    ];
  }

  api.ui.addView({
    id: 'friends',
    title: 'Znajomi',
    icon: 'user',
    render(el) {
      const root = h('div.view-pad.tg');
      el.append(root);
      const draw = () => {
        const focused = document.activeElement && root.contains(document.activeElement) && document.activeElement.tagName === 'INPUT';
        if (focused) return; // nie przerywaj wpisywania
        root.replaceChildren(h('h1.page-title', { text: 'Znajomi' }), ...friendsView());
      };
      friendRedraws.add(draw);
      draw();
      ensureNet().then(draw);
      const tick = setInterval(draw, 15000);
      return () => { friendRedraws.delete(draw); clearInterval(tick); };
    },
  });
  api.commands.register({ id: 'friends', label: 'Znajomi – kto teraz słucha', run: () => api.ui.openView('friends') });
  api.ui.addStyle(`
    .fr-add { margin: 0 0 14px; max-width: 640px; }
    .fr-add .input:nth-child(2) { flex: 0 1 180px; font-family: inherit; letter-spacing: normal; text-transform: none; font-size: 14px; }
    .fr-list { display: grid; gap: 8px; }
    .fr-row { display: flex; align-items: center; gap: 12px; padding: 12px 14px; border-radius: var(--radius); background: var(--surface-2); border: 1px solid var(--border); }
    .fr-row.live { border-color: color-mix(in srgb, var(--accent) 45%, var(--border)); }
    .fr-row .tg-av { width: 40px; height: 40px; font-size: 16px; }
    .fr-row.live .tg-av { box-shadow: 0 0 0 3px var(--surface-2), 0 0 0 5px var(--accent); }
    .fr-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
    .fr-main b { font-size: 15px; }
    .fr-main small { color: var(--text-dim); font-size: 12px; }
    .fr-row.live .fr-main small { color: var(--accent); font-weight: 700; }
    .fr-track { display: flex; align-items: center; gap: 8px; min-width: 0; font-size: 13px; margin-top: 2px; }
    .fr-track span:last-child { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .fr-art { width: 28px; height: 28px; border-radius: 6px; background: var(--elevated) center/cover; flex: none; }
    .fr-actions { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; justify-content: flex-end; }
  `);
  ensureNet();

  api.onDispose(() => {
    clearInterval(heartbeat);
    clearTimeout(pubTimer);
    // pożegnanie – znajomi od razu zobaczą „offline”
    if (net) { net.publish({ off: true }).finally(() => net?.close()); setTimeout(() => net?.close(), 1500); }
    leave(true);
    api.bus.emit('together', { active: false });
  });
}
