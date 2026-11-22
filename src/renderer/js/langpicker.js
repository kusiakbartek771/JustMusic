// Wybór języka: zamiast flag – jedna rzecz charakterystyczna dla kraju.
import { S, flush } from './state.js';
import { h } from './ui.js';
import * as player from './player.js';
import { LANGS } from './i18n.js';

export function switchLang(code) {
  if (!LANGS[code] || code === S.settings.lang) return;
  S.settings.lang = code;
  // przeładowanie interfejsu – muzyka wznowi się w tym samym miejscu
  const wasPlaying = player.P.playing;
  player.saveSession();
  S.data.session = { ...(S.data.session || {}), resumeAfterReload: { playing: wasPlaying } };
  flush();
  setTimeout(() => location.reload(), 150);
}

export function langPicker() {
  const wrap = h('div.lang-picker', { 'data-noi18n': '' });
  for (const [code, l] of Object.entries(LANGS)) {
    wrap.append(h('button.lang-opt' + (code === S.settings.lang ? '.on' : ''), {
      title: l.name,
      on: { click: () => switchLang(code) },
    }, h('span.lang-ico', { text: l.icon, title: l.hint }), h('span.lang-name', { text: l.name })));
  }
  return wrap;
}
