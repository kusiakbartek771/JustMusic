// Mini odtwarzacz – strona aplikacji: wysyła stan do okna mini i wykonuje jego polecenia.
import { S, on, isLiked, toggleLike } from './state.js';
import * as player from './player.js';
import { registerCommand } from './commands.js';

let open = false;

function themeOf() {
  const cs = getComputedStyle(document.documentElement);
  const v = (k) => cs.getPropertyValue('--' + k).trim();
  return { bg: v('bg'), surface: v('surface'), elevated: v('elevated'), text: v('text'), dim: v('text-dim'), accent: v('accent'), accentText: v('accent-text'), border: v('border'), font: v('font'), radius: v('radius') };
}

function full() {
  const t = player.P.current;
  const a = player.P.audio;
  const pb = S.settings.playback;
  return {
    has: !!t,
    id: t?.id || null,
    title: t?.title || '',
    artist: t?.artist || '',
    thumb: t?.thumb ? t.thumb.replace('/mqdefault.jpg', '/hqdefault.jpg') : '',
    playing: player.P.playing,
    loading: player.P.loading,
    time: a.currentTime || 0,
    dur: (Number.isFinite(a.duration) && a.duration) || t?.duration || 0,
    liked: t ? isLiked(t.id) : false,
    vol: pb.volume,
    muted: pb.muted,
    shuffle: pb.shuffle,
    repeat: pb.repeat,
    theme: themeOf(),
  };
}

const push = (part) => { if (open) window.jm.mini.state(part || full()); };

function handle({ cmd, arg }) {
  const t = player.P.current;
  switch (cmd) {
    case 'toggle': player.toggle(); break;
    case 'next': player.next(); break;
    case 'prev': player.prev(); break;
    case 'seek': player.seek(Number(arg) || 0); break;
    case 'seekBy': player.seekBy(Number(arg) || 0); break;
    case 'volume': player.setVolume(Number(arg)); break;
    case 'mute': player.toggleMute(); break;
    case 'like': if (t) toggleLike(t); break;
    case 'shuffle': player.toggleShuffle(); break;
    case 'repeat': player.cycleRepeat(); break;
  }
}

export function toggleMini() { return window.jm.mini.toggle(); }

export function setupMiniPlayer() {
  if (!window.jm.mini) return;
  window.jm.mini.onChanged((v) => { open = !!v; if (open) push(); });
  window.jm.system.onCommand(({ cmd, arg }) => { if (cmd === 'mini') handle(arg || {}); });
  for (const ev of ['track', 'state', 'loading', 'liked', 'volume', 'modes', 'settings']) on(ev, () => push());
  let last = 0;
  on('time', () => {
    const n = performance.now();
    if (n - last < 500) return;
    last = n;
    const a = player.P.audio;
    push({ time: a.currentTime || 0, dur: (Number.isFinite(a.duration) && a.duration) || player.P.current?.duration || 0, playing: player.P.playing });
  });
  registerCommand({ id: 'ui.mini', label: 'Mini odtwarzacz', group: 'Okno', run: () => toggleMini() });
  window.jm.mini.isOpen().then((v) => { open = !!v; push(); }).catch(() => {});
}
