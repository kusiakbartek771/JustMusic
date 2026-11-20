// Plugin: wyłącznik czasowy.
export default function activate(api) {
  let endAt = 0;          // timestamp końca
  let endOfTrack = false;
  let tick = null;
  let fading = false;
  let savedVolume = null;

  const btn = api.ui.addPlayerButton({ id: 'btn', icon: 'moon', title: 'Wyłącznik czasowy', onClick: (e, el) => openMenu(el) });

  function fmt(ms) {
    const s = Math.max(0, Math.round(ms / 1000));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }

  function cancel(silent) {
    endAt = 0;
    endOfTrack = false;
    clearInterval(tick);
    tick = null;
    if (fading && savedVolume !== null) api.player.setVolume(savedVolume);
    fading = false;
    savedVolume = null;
    btn.setActive(false);
    btn.setTitle('Wyłącznik czasowy');
    if (!silent) api.ui.toast('Wyłącznik czasowy anulowany');
  }

  function stopNow() {
    api.player.pause();
    const v = savedVolume;
    cancel(true);
    if (v !== null) setTimeout(() => api.player.setVolume(v), 600);
    api.ui.toast('Dobranoc 🌙 – muzyka zatrzymana');
  }

  function start(minutes) {
    cancel(true);
    endAt = Date.now() + minutes * 60000;
    btn.setActive(true);
    tick = setInterval(() => {
      const left = endAt - Date.now();
      btn.setTitle(`Wyłącznik: ${fmt(left)}`);
      // wyciszanie przez ostatnie 15 s
      if (left <= 15000 && left > 0) {
        if (!fading) { fading = true; savedVolume = api.player.volume; }
        api.player.setVolume(savedVolume * (left / 15000));
      }
      if (left <= 0) stopNow();
    }, 500);
    api.ui.toast(`Muzyka zatrzyma się za ${minutes} min`);
  }

  function startEndOfTrack() {
    cancel(true);
    endOfTrack = true;
    btn.setActive(true);
    btn.setTitle('Wyłącznik: po tym utworze');
    api.ui.toast('Muzyka zatrzyma się po bieżącym utworze');
  }

  api.player.on('track', () => {
    if (endOfTrack) {
      endOfTrack = false;
      setTimeout(stopNow, 50);
    }
  });

  function openMenu(anchor) {
    const r = anchor.getBoundingClientRect();
    const items = [
      { title: endAt ? `Pozostało ${fmt(endAt - Date.now())}` : endOfTrack ? 'Po bieżącym utworze' : 'Zatrzymaj muzykę za…' },
      ...[5, 15, 30, 45, 60, 90, 120].map((m) => ({ label: `${m} min`, icon: 'clock', onClick: () => start(m) })),
      { label: 'Po bieżącym utworze', icon: 'music', onClick: startEndOfTrack },
      { label: 'Własny czas…', icon: 'edit', onClick: async () => {
        const v = await api.ui.prompt({ title: 'Wyłącznik czasowy', text: 'Liczba minut:', value: '20', ok: 'Ustaw' });
        const m = Number(v);
        if (m > 0) start(m);
      } },
      (endAt || endOfTrack) ? { sep: true } : null,
      (endAt || endOfTrack) ? { label: 'Anuluj', icon: 'x', danger: true, onClick: () => cancel() } : null,
    ];
    api.ui.contextMenu({ clientX: r.left - 120, clientY: r.top - 330 }, items);
  }

  return () => cancel(true);
}
