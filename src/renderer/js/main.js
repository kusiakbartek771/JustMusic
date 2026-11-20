// JustMusic – start interfejsu.
import { S, initState, on, emit, flush, toggleLike } from './state.js';
import { applyAll, setupResizers } from './theme.js';
import { navigate, goBack, goForward } from './router.js';
import { renderTitlebar, renderSidebar, focusSearch, toggleQueue } from './shell.js';
import { renderPlayer, renderQueue } from './playerbar.js';
import * as player from './player.js';
import { createPlaylist, bookmarkMoment } from './actions.js';
import { loadCached, rescan, setupFileDrop } from './library.js';
import { loadPlugins } from './plugins.js';
import { verifyDownloads } from './downloads.js';
import { toast } from './ui.js';
import { registerBuiltinCommands, shortcutState } from './commands.js';
import { setupSystemIntegration } from './sysint.js';
import { setupUpdates } from './updates.js';
import './views.js';
import './settings.js';

async function boot() {
  await initState();
  document.documentElement.classList.add(S.platform === 'darwin' ? 'mac' : S.platform === 'win32' ? 'win' : 'linux');
  applyAll();
  window.jm.yt.config(S.settings.youtube).catch(() => {});

  renderTitlebar();
  renderSidebar();
  renderPlayer();
  renderQueue();
  setupResizers();
  setupFileDrop();
  setupShortcuts();
  await registerBuiltinCommands();
  setupSystemIntegration();
  setupUpdates();

  await loadCached();
  player.restoreSession();
  navigate('home', null, { replace: true });

  // w tle: status yt-dlp, skan biblioteki, pluginy, weryfikacja pobranych
  window.jm.yt.status().then((st) => {
    S.ytStatus = st;
    emit('yt:status');
  }).catch(() => {});
  if (S.settings.library.scanOnStart && S.settings.library.folders.length) rescan(false);
  verifyDownloads();
  loadPlugins();

  // Ostatnia linia obrony przed zgubieniem danych
  window.addEventListener('beforeunload', () => flush());
}

on('yt:status', () => {
  // odśwież stronę startową, jeśli pokazuje baner o braku yt-dlp
  import('./router.js').then((r) => { if (r.route.name === 'home') r.refresh(); });
});

function setupShortcuts() {
  document.addEventListener('keydown', (e) => {
    const mod = e.ctrlKey || e.metaKey;
    if (!shortcutState.defaults || e.defaultPrevented) return;
    const typing = e.target.closest('input, textarea, select, [contenteditable]');
    const k = e.key;

    if (mod && (k === 'k' || k === 'K' || k === 'f' || k === 'F')) { e.preventDefault(); return focusSearch(); }
    if (mod && k === ',') { e.preventDefault(); return navigate('settings'); }
    if (mod && (k === 'n' || k === 'N')) { e.preventDefault(); return createPlaylist({ open: true }); }
    if (mod && (k === 'b' || k === 'B')) { e.preventDefault(); return bookmarkMoment(e.shiftKey); }
    if (e.altKey && k === 'ArrowLeft') { e.preventDefault(); return goBack(); }
    if (e.altKey && k === 'ArrowRight') { e.preventDefault(); return goForward(); }
    if (typing) return;

    if (k === ' ' || k === 'MediaPlayPause') { e.preventDefault(); return player.toggle(); }
    if (mod && k === 'ArrowRight') { e.preventDefault(); return player.next(); }
    if (mod && k === 'ArrowLeft') { e.preventDefault(); return player.prev(); }
    if (mod && k === 'ArrowUp') { e.preventDefault(); return player.setVolume(S.settings.playback.volume + 0.05); }
    if (mod && k === 'ArrowDown') { e.preventDefault(); return player.setVolume(S.settings.playback.volume - 0.05); }
    if (e.shiftKey && k === 'ArrowRight') { e.preventDefault(); return player.seekBy(S.settings.playback.seekStep); }
    if (e.shiftKey && k === 'ArrowLeft') { e.preventDefault(); return player.seekBy(-S.settings.playback.seekStep); }
    if (mod || e.altKey) return;
    switch (k.toLowerCase()) {
      case '/': e.preventDefault(); return focusSearch();
      case 'm': return player.toggleMute();
      case 'l': if (player.P.current) { const liked = toggleLike(player.P.current); toast(liked ? 'Polubiono ♥' : 'Usunięto z polubionych'); } return;
      case 's': return player.toggleShuffle();
      case 'r': return player.cycleRepeat();
      case 'q': return toggleQueue();
    }
  });
  // przyciski "wstecz/dalej" myszy
  window.addEventListener('mouseup', (e) => {
    if (e.button === 3) goBack();
    if (e.button === 4) goForward();
  });
}

boot().catch((e) => {
  console.error(e);
  document.body.innerHTML = `<pre style="padding:24px;color:#f66">JustMusic nie uruchomił się:\n${e.stack || e}</pre>`;
});
