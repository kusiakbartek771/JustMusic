// Aktualizacje: automatyczne sprawdzanie, powiadomienia i panel w ustawieniach.
import { S, on, emit } from './state.js';
import { h, esc, btn, toast } from './ui.js';
import { icon } from './icons.js';
import { titlebarItems } from './shell.js';

export const U = { state: null };
let notifiedVersion = null;

function chip() {
  const st = U.state;
  const key = 'core:update';
  if (!st || !['available', 'downloading', 'ready'].includes(st.state)) {
    if (titlebarItems.delete(key)) emit('titlebar:items');
    return;
  }
  const label = st.state === 'ready' ? 'Uruchom ponownie' : st.state === 'downloading' ? `Aktualizacja ${st.percent || 0}%` : `Nowa wersja ${st.version}`;
  const el = h('button.tb-chip', {
    title: st.state === 'ready' ? 'Kliknij, aby zainstalować aktualizację i uruchomić ponownie' : 'Dostępna aktualizacja JustMusic',
    html: `${icon(st.state === 'ready' ? 'refresh' : 'download')}<span>${esc(label)}</span>`,
    on: { click: () => (st.state === 'ready' ? window.jm.update.install() : st.state === 'available' ? startDownload() : null) },
  });
  titlebarItems.set(key, { el });
  emit('titlebar:items');
}

export function startDownload() {
  window.jm.update.download().catch((e) => toast(e.message, { error: true }));
  if (!U.state?.auto) toast('Otwieram stronę pobierania nowej wersji…');
}

export function setupUpdates() {
  window.jm.update.state().then((st) => { U.state = st; emit('update'); }).catch(() => {});
  window.jm.update.onStatus((st) => {
    U.state = st;
    chip();
    emit('update');
    if (st.state === 'available' && notifiedVersion !== st.version) {
      notifiedVersion = st.version;
      if (S.settings.updates.autoDownload && st.auto) startDownload();
      else toast(`Dostępna nowa wersja JustMusic ${st.version}`, { action: { label: st.auto ? 'Aktualizuj' : 'Pobierz', onClick: startDownload }, duration: 10000 });
    }
    if (st.state === 'ready') toast(`Wersja ${st.version} gotowa – zainstaluje się przy zamknięciu`, { action: { label: 'Uruchom ponownie', onClick: () => window.jm.update.install() }, duration: 12000 });
  });
  if (S.settings.updates.autoCheck) setTimeout(() => window.jm.update.check().catch(() => {}), 8000);
  // ponowne sprawdzenie co 6 godzin
  setInterval(() => { if (S.settings.updates.autoCheck) window.jm.update.check().catch(() => {}); }, 6 * 3600e3);
}

// Panel w Ustawienia → O aplikacji
export function updatesPanel(row, toggleRow) {
  const box = h('div');
  const draw = () => {
    const st = U.state || {};
    const status = {
      checking: 'Sprawdzanie…',
      none: '<span class="status-dot ok"></span>Masz najnowszą wersję',
      available: `Dostępna wersja <b>${esc(st.version)}</b>`,
      downloading: `Pobieranie… ${st.percent || 0}%`,
      ready: `Wersja <b>${esc(st.version)}</b> pobrana – gotowa do instalacji`,
      error: `<span class="status-dot"></span>${esc(st.error || 'Błąd')}`,
    }[st.state] || 'Nie sprawdzano';
    const action = st.state === 'available'
      ? btn(st.auto ? 'Pobierz i zainstaluj' : 'Pobierz', { icon: 'download', primary: true, cls: 'sm', onClick: startDownload })
      : st.state === 'ready'
        ? btn('Zainstaluj i uruchom ponownie', { icon: 'refresh', primary: true, cls: 'sm', onClick: () => window.jm.update.install() })
        : btn('Sprawdź teraz', { icon: 'refresh', cls: 'sm', onClick: () => window.jm.update.check() });
    box.replaceChildren(...[
      row(`Wersja ${S.version}`, status, action),
      st.state === 'downloading' ? h('div', { style: { padding: '0 18px 14px' } }, h('div.progress', null, h('i', { style: { width: (st.percent || 0) + '%' } }))) : null,
      st.notes && st.state !== 'none' ? h('details', { style: { padding: '0 18px 14px', fontSize: '13px' } }, h('summary', { text: 'Co nowego?', style: { cursor: 'pointer', color: 'var(--text-dim)' } }), h('p', { text: st.notes, style: { whiteSpace: 'pre-line', margin: '8px 0 0' } })) : null,
      !st.auto && st.state ? h('div.setting', null, h('div.lbl', { html: `<small>${S.packaged ? 'Ta wersja (np. portable, .deb, .pacman, macOS) aktualizuje się przez pobranie nowego instalatora – przycisk otworzy właściwy plik.' : 'Tryb deweloperski – aktualizacje pobierzesz poleceniem <span class="code">git pull</span>.'}</small>` })) : null,
      toggleRow('Sprawdzaj automatycznie', 'Przy starcie i co 6 godzin.', S.settings.updates, 'autoCheck'),
      st.auto ? toggleRow('Pobieraj automatycznie', 'Nowa wersja zainstaluje się przy następnym zamknięciu aplikacji.', S.settings.updates, 'autoDownload') : null,
      st.releases ? row('Wszystkie wydania', 'Lista zmian i pliki do pobrania na GitHubie.', btn('Otwórz', { icon: 'external', cls: 'sm ghost', onClick: () => window.jm.shell.external(st.releases) })) : null,
    ].filter(Boolean));
  };
  draw();
  const off = on('update', () => { if (box.isConnected) draw(); else off(); });
  return box;
}
