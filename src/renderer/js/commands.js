// Rejestr poleceń aplikacji – wszystko, co można wywołać skrótem, z zasobnika lub z pluginu.
import { S, emit, toggleLike, saveSettings } from './state.js';
import { toast } from './ui.js';

const commands = new Map();
export const shortcutState = { defaults: true }; // pluginy mogą wyłączyć domyślne skróty // id -> { id, label, group, run }

export function registerCommand(cmd) {
  commands.set(cmd.id, { group: 'Inne', ...cmd });
  emit('commands');
  return () => { commands.delete(cmd.id); emit('commands'); };
}

export function listCommands() {
  return [...commands.values()];
}

export function runCommand(id, ...args) {
  const c = commands.get(id);
  if (!c) return false;
  try { c.run(...args); } catch (e) { console.error('[command]', id, e); toast(e.message, { error: true }); }
  return true;
}

// Wbudowane polecenia (rejestrowane po starcie, bo potrzebują modułów interfejsu)
export async function registerBuiltinCommands() {
  const player = await import('./player.js');
  const router = await import('./router.js');
  const shell = await import('./shell.js');
  const actions = await import('./actions.js');
  const theme = await import('./theme.js');
  const dl = await import('./downloads.js');
  const L = () => S.settings.layout;
  const relayout = () => { theme.applyLayout(); saveSettings(); emit('queuePanel'); emit('settings'); };

  const add = (group, id, label, run) => registerCommand({ id, label, group, run });
  // odtwarzanie
  add('Odtwarzanie', 'player.toggle', 'Odtwórz / pauza', () => player.toggle());
  add('Odtwarzanie', 'player.next', 'Następny utwór', () => player.next());
  add('Odtwarzanie', 'player.prev', 'Poprzedni utwór', () => player.prev());
  add('Odtwarzanie', 'player.forward', 'Przewiń do przodu', () => player.seekBy(S.settings.playback.seekStep));
  add('Odtwarzanie', 'player.back', 'Przewiń do tyłu', () => player.seekBy(-S.settings.playback.seekStep));
  add('Odtwarzanie', 'player.restart', 'Od początku utworu', () => player.seek(0));
  add('Odtwarzanie', 'player.volUp', 'Głośniej', () => player.setVolume(S.settings.playback.volume + 0.05));
  add('Odtwarzanie', 'player.bassUp', 'Więcej basu', () => player.setBass((S.settings.playback.bass || 0) + 1));
  add('Odtwarzanie', 'player.bassDown', 'Mniej basu', () => player.setBass((S.settings.playback.bass || 0) - 1));
  add('Odtwarzanie', 'player.bassReset', 'Bas: wyłącz wzmocnienie', () => player.setBass(0));
  add('Odtwarzanie', 'player.volDown', 'Ciszej', () => player.setVolume(S.settings.playback.volume - 0.05));
  add('Odtwarzanie', 'player.mute', 'Wycisz / przywróć dźwięk', () => player.toggleMute());
  add('Odtwarzanie', 'player.shuffle', 'Losowo wł./wył.', () => player.toggleShuffle());
  add('Odtwarzanie', 'player.repeat', 'Tryb powtarzania', () => player.cycleRepeat());
  add('Odtwarzanie', 'player.eq', 'Korektor wł./wył.', () => { const eq = S.settings.playback.eq; eq.enabled = !eq.enabled; player.applyEq(); saveSettings(); emit('modes'); toast(eq.enabled ? 'Korektor włączony' : 'Korektor wyłączony'); });
  add('Odtwarzanie', 'queue.clear', 'Wyczyść kolejkę', () => player.clearQueue());
  // utwór
  add('Utwór', 'track.like', 'Polub aktualny utwór', () => { if (player.P.current) toast(toggleLike(player.P.current) ? 'Polubiono ♥' : 'Usunięto z polubionych'); });
  add('Utwór', 'track.bookmark', 'Zapisz moment (zakładka)', () => actions.bookmarkMoment(false));
  add('Utwór', 'track.bookmarkNote', 'Zapisz moment z notatką', () => actions.bookmarkMoment(true));
  add('Utwór', 'track.download', 'Pobierz aktualny utwór', () => player.P.current && dl.downloadTracks([player.P.current]));
  add('Utwór', 'track.addToNewPlaylist', 'Dodaj aktualny utwór do nowej playlisty', () => player.P.current && actions.createPlaylist({ tracks: [player.P.current] }));
  add('Utwór', 'track.searchArtist', 'Pokaż wykonawcę aktualnego utworu', () => { const a = player.P.current?.artist; if (a) router.navigate('artist', { name: a.split(',')[0].trim() }); });
  // nawigacja
  for (const [id, label] of [['home', 'Start'], ['library', 'Biblioteka'], ['liked', 'Polubione'], ['bookmarks', 'Zakładki'], ['downloads', 'Pobrane'], ['import', 'Import'], ['settings', 'Ustawienia'], ['plugins', 'Sklep z pluginami']]) {
    add('Nawigacja', `nav.${id}`, `Otwórz: ${label}`, () => (id === 'plugins' ? router.navigate('settings', 'plugins') : router.navigate(id)));
  }
  add('Nawigacja', 'nav.search', 'Szukaj', () => shell.focusSearch());
  add('Nawigacja', 'nav.back', 'Wstecz', () => router.goBack());
  add('Nawigacja', 'nav.forward', 'Dalej', () => router.goForward());
  add('Nawigacja', 'playlist.new', 'Nowa playlista', () => actions.createPlaylist({ open: true }));
  add('Nawigacja', 'app.feedback', 'Wyślij opinię', () => import('./feedback.js').then((f) => f.openFeedback()));
  // wygląd
  add('Wygląd', 'ui.queue', 'Pokaż/ukryj kolejkę', () => shell.toggleQueue());
  add('Wygląd', 'ui.sidebar', 'Pokaż/ukryj menu', () => { L().sidebarHidden = !L().sidebarHidden; relayout(); });
  add('Wygląd', 'ui.compact', 'Kompaktowe menu wł./wył.', () => { L().sidebarCompact = !L().sidebarCompact; relayout(); });
  add('Wygląd', 'ui.playerPos', 'Odtwarzacz góra/dół', () => { L().player = L().player === 'top' ? 'bottom' : 'top'; relayout(); });
  add('Wygląd', 'ui.sidebarSide', 'Menu lewo/prawo', () => { L().sidebar = L().sidebar === 'right' ? 'left' : 'right'; relayout(); });
  add('Wygląd', 'ui.nextTheme', 'Następny motyw', () => {
    const ids = Object.keys(theme.PRESETS);
    const i = ids.indexOf(S.settings.theme.preset);
    S.settings.theme.preset = ids[(i + 1) % ids.length];
    S.settings.theme.custom = {};
    saveSettings(); emit('settings');
    toast('Motyw: ' + theme.PRESETS[S.settings.theme.preset].name);
  });
  add('Wygląd', 'ui.fullscreen', 'Pełny ekran', () => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()));
  // okno
  add('Okno', 'win.minimize', 'Minimalizuj okno', () => window.jm.window.minimize());
  add('Okno', 'win.maximize', 'Maksymalizuj / przywróć okno', () => window.jm.window.toggleMaximize());
  add('Okno', 'win.close', 'Zamknij okno', () => window.jm.window.close());
}
