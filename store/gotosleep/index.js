// Plugin: GoToSleep – wykrywanie nieobecności (AFK), stopniowe przyciszanie i status AFK.
export default function activate(api) {
  const D = { minutes: 3, fadeSeconds: 60, endAction: 'pause', minVolume: 15, resume: true, onlyPlaying: true, source: 'auto' };
  const cfg = () => ({ ...D, ...api.storage.get('cfg', {}) });
  const save = (patch) => api.storage.set('cfg', { ...cfg(), ...patch });

  let afk = false;
  let manual = false;
  let afkSince = 0;
  let pausedByUs = false;
  let systemIdleWorks = false;
  let lastAppInput = Date.now();
  let fadeTimer = null;

  const badge = api.ui.addTitlebarItem({ id: 'afk', icon: 'zzz', text: 'AFK', title: 'Jesteś AFK – kliknij, aby wrócić', onClick: () => back(true) });
  badge.show(false);

  // aktywność w samym oknie aplikacji (zapas, gdy system nie raportuje bezczynności, np. część sesji Wayland)
  const mark = () => { lastAppInput = Date.now(); if (afk && !manual) back(); };
  for (const ev of ['mousemove', 'mousedown', 'keydown', 'wheel', 'touchstart']) {
    window.addEventListener(ev, mark, { passive: true, capture: true });
    api.onDispose(() => window.removeEventListener(ev, mark, { capture: true }));
  }

  async function idleSeconds() {
    const c = cfg();
    const appIdle = (Date.now() - lastAppInput) / 1000;
    if (c.source === 'app') return appIdle;
    let sys = 0;
    try { sys = (await api.system.idle()).seconds || 0; } catch {}
    if (sys > 2) systemIdleWorks = true;
    if (c.source === 'system' || systemIdleWorks) return sys;
    return document.hasFocus() ? appIdle : sys; // auto: dopóki system nie potwierdzi, że raportuje
  }

  function enterAfk(isManual = false) {
    if (afk) return;
    afk = true;
    manual = isManual;
    afkSince = Date.now();
    badge.show(true);
    api.bus.emit('afk', true);
    const c = cfg();
    const steps = Math.max(1, c.fadeSeconds);
    let i = 0;
    clearInterval(fadeTimer);
    const target = c.endAction === 'pause' ? 0 : c.minVolume / 100;
    fadeTimer = setInterval(() => {
      i++;
      const k = Math.min(1, i / steps);
      api.player.duck(1 - (1 - target) * k, 1000);
      if (k >= 1) {
        clearInterval(fadeTimer);
        if (c.endAction === 'pause' && api.player.playing) {
          pausedByUs = true;
          api.player.pause();
          setTimeout(() => api.player.duck(1, 0), 600);
        }
      }
    }, 1000);
  }

  function back(fromBadge = false) {
    if (!afk) return;
    const c = cfg();
    afk = false;
    manual = false;
    clearInterval(fadeTimer);
    badge.show(false);
    api.bus.emit('afk', false);
    api.player.duck(1, 1500);
    if (pausedByUs && c.resume) api.player.resume();
    pausedByUs = false;
    const mins = Math.round((Date.now() - afkSince) / 60000);
    api.ui.toast(mins >= 1 ? `Witaj z powrotem! Nie było Cię ${mins} min 👋` : 'Witaj z powrotem 👋');
    if (fromBadge) lastAppInput = Date.now();
  }

  const loop = setInterval(async () => {
    const c = cfg();
    const idle = await idleSeconds();
    if (!afk) {
      if (idle >= c.minutes * 60 && (!c.onlyPlaying || api.player.playing)) enterAfk();
    } else if (!manual && idle < 3) back();
  }, 3000);
  api.onDispose(() => { clearInterval(loop); clearInterval(fadeTimer); api.player.duck(1, 0); if (afk) api.bus.emit('afk', false); });

  api.commands.register({ id: 'toggle', label: 'Tryb AFK wł./wył.', run: () => (afk ? back() : enterAfk(true)) });

  api.ui.addSettings((el) => {
    const c = cfg();
    const range = (key, min, max, step, unit) => {
      const r = api.h('input.range', { type: 'range', min, max, step });
      r.value = c[key]; api.ui.rangeFill(r);
      const v = api.h('span', { text: c[key] + unit, style: { width: '54px', textAlign: 'right' } });
      r.addEventListener('input', () => { v.textContent = r.value + unit; api.ui.rangeFill(r); });
      r.addEventListener('change', () => save({ [key]: Number(r.value) }));
      return [r, v];
    };
    el.append(
      api.ui.settingRow('AFK po', 'Ile minut bez ruchu myszy i klawiatury.', ...range('minutes', 1, 30, 1, ' min')),
      api.ui.settingRow('Czas wyciszania', 'Jak długo muzyka ma płynnie cichnąć.', ...range('fadeSeconds', 5, 300, 5, ' s')),
      api.ui.settingRow('Na koniec', null, api.ui.select([['pause', 'Zatrzymaj muzykę'], ['quiet', 'Graj dalej po cichu']], c.endAction, (v) => save({ endAction: v }))),
      api.ui.settingRow('Głośność „po cichu”', 'Dotyczy opcji „Graj dalej po cichu”.', ...range('minVolume', 0, 60, 5, '%')),
      api.ui.settingRow('Wznów po powrocie', 'Jeśli GoToSleep zatrzymał muzykę – włączy ją ponownie, gdy wrócisz.', api.ui.switch(c.resume, (v) => save({ resume: v }))),
      api.ui.settingRow('Tylko gdy muzyka gra', null, api.ui.switch(c.onlyPlaying, (v) => save({ onlyPlaying: v }))),
      api.ui.settingRow('Wykrywanie aktywności', 'Automatycznie: cały system, a gdy niedostępne – tylko okno JustMusic.',
        api.ui.select([['auto', 'Automatycznie'], ['system', 'Cały system'], ['app', 'Tylko okno JustMusic']], c.source, (v) => save({ source: v }))),
      api.ui.settingRow('Test', 'Włącz tryb AFK teraz. Wyłączysz go, klikając znacznik „AFK” na górnym pasku.', api.ui.button('Jestem AFK', { cls: 'sm', icon: 'zzz', onClick: () => enterAfk(true) })),
    );
  });
}
