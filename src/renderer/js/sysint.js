// Synchronizacja z systemem: zasobnik, pasek zadań (postęp, przyciski miniatury) i polecenia z zewnątrz.
import { S, on, isLiked, toggleLike } from './state.js';
import * as player from './player.js';
import { runCommand } from './commands.js';

export function setupSystemIntegration() {
  const sendNow = () => {
    const t = player.P.current;
    window.jm.system.nowPlaying({ hasTrack: !!t, title: t?.title || '', artist: t?.artist || '', playing: player.P.playing, liked: !!t && isLiked(t.id) }).catch(() => {});
  };
  on('track', sendNow);
  on('state', sendNow);
  on('liked', sendNow);

  let last = 0;
  const sendProgress = () => {
    const a = player.P.audio;
    if (!S.settings.system.taskbarProgress || !player.P.current || !a.duration || !Number.isFinite(a.duration)) {
      window.jm.system.progress(-1).catch(() => {});
      return;
    }
    window.jm.system.progress(a.currentTime / a.duration, player.P.playing ? 'normal' : 'paused').catch(() => {});
  };
  on('time', () => {
    const n = performance.now();
    if (n - last < 1000) return;
    last = n;
    sendProgress();
  });
  on('state', sendProgress);
  on('settings', sendProgress);

  window.jm.system.onCommand(({ cmd, arg }) => {
    if (cmd === 'toggle') player.toggle();
    else if (cmd === 'next') player.next();
    else if (cmd === 'prev') player.prev();
    else if (cmd === 'seekBy') player.seekBy(Number(arg) || 0);
    else if (cmd === 'like') { if (player.P.current) toggleLike(player.P.current); }
    else if (cmd === 'shortcut') runCommand(arg);
  });
  sendNow();
}
