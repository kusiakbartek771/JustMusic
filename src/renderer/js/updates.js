// Aktualizacje: automatyczne sprawdzanie, pobieranie w tle i przełączanie na nową wersję.
// Gdy aktualizacja jest gotowa, aplikacja sama się restartuje – od razu, jeśli nic nie gra,
// albo między utworami. Po restarcie muzyka gra dalej od tego samego miejsca.
import { S, on, emit, saveData, flush } from './state.js';
import { h, esc, btn, toast } from './ui.js';
import { icon } from './icons.js';
import { titlebarItems } from './shell.js';
import * as player from './player.js';

export const U = { state: null };
let notifiedVersion = null;
let scheduled = false;
let cancelled = false;

const autoInstall = () => S.settings.updates.autoInstall !== false;

function chip() {
  const st = U.state;
  const key = 'core:update';
  if (!st || !['available', 'downloading', 'ready'].includes(st.state) || (autoInstall() && st.auto && st.state !== 'ready')) {
    if (titlebarItems.delete(key)) emit('titlebar:items');
    return;
  }
  const label = st.state === 'ready' ? `Zaktualizuj do ${st.version}` : st.state === 'downloading' ? `Aktualizacja ${st.percent || 0}%` : `Nowa wersja ${st.version}`;
  const el = h('button.tb-chip', {
    title: st.state === 'ready' ? 'Kliknij, aby od razu przełączyć się na nową wersję' : 'Dostępna aktualizacja JustMusic',
    html: `${icon(st.state === 'ready' ? 'refresh' : 'download')}<span>${esc(label)}</span>`,
    on: { click: () => (st.state === 'ready' ? installNow() : st.state === 'available' ? startDownload() : null) },
  });
  titlebarItems.set(key, { el });
  emit('titlebar:items');
}

export function startDownload() {
  window.jm.update.download().catch((e) => toast(e.message, { error: true }));
  if (!U.state?.auto) toast('Otwieram stronę pobierania nowej wersji…');
}

// Zapamiętaj stan odtwarzania, zainstaluj i uruchom nową wersję
export function installNow() {
  const wasPlaying = player.P.playing;
  player.saveSession();
  S.data.session = { ...(S.data.session || {}), resumeAfterUpdate: { playing: wasPlaying, from: S.version, to: U.state?.version } };
  saveData();
  flush();
  setTimeout(() => window.jm.update.install(), 400);
}

// Wybór momentu: od razu, gdy nic nie gra; między utworami, gdy muzyka gra
function scheduleInstall() {
  if (scheduled || cancelled) return;
  scheduled = true;
  const v = U.state?.version;
  if (!player.P.playing) {
    let left = 10;
    let timer = null;
    const close = toast(`Aktualizacja do wersji ${v} – przełączam za ${left} s`, {
      duration: 11000,
      action: { label: 'Później', onClick: () => { clearInterval(timer); cancelled = true; scheduled = false; toast('Aktualizacja zainstaluje się przy zamknięciu aplikacji'); } },
    });
    timer = setInterval(() => {
      left--;
      // jeśli w międzyczasie włączono muzykę – poczekaj do końca utworu
      if (player.P.playing) { clearInterval(timer); close(); scheduled = false; return scheduleInstall(); }
      if (left <= 0) { clearInterval(timer); installNow(); }
    }, 1000);
    return;
  }
  toast(`Wersja ${v} pobrana – przełączę się po tym utworze`, { duration: 6000, action: { label: 'Teraz', onClick: installNow } });
  const offTrack = on('track', () => { offTrack(); offState(); installNow(); });
  // pauza dłuższa niż 5 s też jest dobrym momentem
  let pauseTimer = null;
  const offState = on('state', () => {
    clearTimeout(pauseTimer);
    if (!player.P.playing) pauseTimer = setTimeout(() => { if (!player.P.playing) { offTrack(); offState(); installNow(); } }, 5000);
  });
}

// Po restarcie z aktualizacji: komunikat + wznowienie muzyki
function afterUpdate() {
  const r = S.data.session?.resumeAfterUpdate;
  if (!r) return;
  delete S.data.session.resumeAfterUpdate;
  saveData();
  setTimeout(() => {
    toast(`Zaktualizowano do wersji ${S.version} ✓`, { duration: 5000, action: { label: 'Co nowego?', onClick: () => import('./router.js').then((m) => m.navigate('settings', 'about')) } });
    if (r.playing && player.P.current && !player.P.playing) player.toggle();
  }, 600);
}

export function setupUpdates() {
  afterUpdate();
  window.jm.update.state().then((st) => { U.state = st; emit('update'); }).catch(() => {});
  window.jm.update.onStatus((st) => {
    U.state = st;
    chip();
    emit('update');
    if (st.state === 'available' && notifiedVersion !== st.version) {
      notifiedVersion = st.version;
      if (!st.auto) toast(`Dostępna nowa wersja JustMusic ${st.version}`, { action: { label: 'Pobierz', onClick: startDownload }, duration: 10000 });
      else if (!autoInstall()) toast(`Dostępna nowa wersja JustMusic ${st.version}`, { action: { label: 'Aktualizuj', onClick: startDownload }, duration: 10000 });
      // przy automatycznej instalacji pobieranie startuje samo w procesie głównym
    }
    if (st.state === 'ready') {
      if (autoInstall()) scheduleInstall();
      else toast(`Wersja ${st.version} gotowa`, { action: { label: 'Uruchom ponownie', onClick: installNow }, duration: 12000 });
    }
  });
  if (S.settings.updates.autoCheck) setTimeout(() => window.jm.update.check().catch(() => {}), 8000);
  // ponowne sprawdzanie co 2 godziny
  setInterval(() => { if (S.settings.updates.autoCheck) window.jm.update.check().catch(() => {}); }, 2 * 3600e3);
}

// Panel w Ustawienia → O aplikacji
export function updatesPanel(row, toggleRow) {
  const box = h('div');
  const draw = () => {
    const st = U.state || {};
    const status = {
      checking: 'Sprawdzanie…',
      none: '<span class="status-dot ok"></span>Masz najnowszą wersję',
      available: `Dostępna wersja <b>${esc(st.version)}</b>${st.auto && autoInstall() ? ' – pobieram…' : ''}`,
      downloading: `Pobieranie wersji ${esc(st.version || '')}… ${st.percent || 0}%`,
      ready: `Wersja <b>${esc(st.version)}</b> gotowa${autoInstall() ? ' – przełączę się, gdy nic nie będzie grało' : ''}`,
      error: `<span class="status-dot"></span>${esc(st.error || 'Błąd')}`,
    }[st.state] || 'Nie sprawdzano';
    const action = st.state === 'available' && !(st.auto && autoInstall())
      ? btn(st.auto ? 'Pobierz i zainstaluj' : 'Pobierz', { icon: 'download', primary: true, cls: 'sm', onClick: startDownload })
      : st.state === 'ready'
        ? btn('Przełącz teraz', { icon: 'refresh', primary: true, cls: 'sm', onClick: installNow })
        : st.state === 'downloading' ? null
          : btn('Sprawdź teraz', { icon: 'refresh', cls: 'sm', onClick: () => window.jm.update.check() });
    box.replaceChildren(...[
      row(`Wersja ${S.version}`, status, action),
      st.state === 'downloading' ? h('div', { style: { padding: '0 18px 14px' } }, h('div.progress', null, h('i', { style: { width: (st.percent || 0) + '%' } }))) : null,
      st.notes && st.state !== 'none' ? h('details', { style: { padding: '0 18px 14px', fontSize: '13px' } }, h('summary', { text: 'Co nowego?', style: { cursor: 'pointer', color: 'var(--text-dim)' } }), h('p', { text: st.notes, style: { whiteSpace: 'pre-line', margin: '8px 0 0' } })) : null,
      st.auto
        ? toggleRow('Instaluj aktualizacje automatycznie', 'Nowa wersja pobiera się w tle, a JustMusic sam się na nią przełącza – od razu, gdy nic nie gra, albo między utworami. Muzyka gra dalej od tego samego miejsca.', S.settings.updates, 'autoInstall')
        : h('div.setting', null, h('div.lbl', { html: `<small>${S.packaged ? 'Ta wersja (portable, .deb, .pacman lub macOS) nie może zaktualizować się sama – przycisk otworzy nowy plik. Automatyczne aktualizacje mają instalator Windows i AppImage na Linuksie.' : 'Tryb deweloperski – aktualizacje pobierzesz poleceniem <span class="code">git pull</span>.'}</small>` })),
      toggleRow('Sprawdzaj automatycznie', 'Przy starcie i co 2 godziny.', S.settings.updates, 'autoCheck'),
      st.releases ? row('Wszystkie wydania', 'Lista zmian i pliki do pobrania na GitHubie.', btn('Otwórz', { icon: 'external', cls: 'sm ghost', onClick: () => window.jm.shell.external(st.releases) })) : null,
    ].filter(Boolean));
  };
  draw();
  const off = on('update', () => { if (box.isConnected) draw(); else off(); });
  return box;
}
