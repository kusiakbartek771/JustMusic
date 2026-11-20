// Plugin: Bouncy – aplikacja trzęsie się / pulsuje przy mocnym basie.
export default function activate(api) {
  const { h } = api;
  const D = { effect: 'shake', target: 'app', intensity: 60, sensitivity: 55, flash: true };
  const cfg = () => ({ ...D, ...api.storage.get('cfg', {}) });
  const save = (patch) => api.storage.set('cfg', { ...cfg(), ...patch });

  const analyser = api.audio.getAnalyser();
  if (!analyser) { api.ui.toast('Bouncy: analizator audio niedostępny', { error: true }); return; }
  const data = new Uint8Array(analyser.frequencyBinCount);
  const sampleRate = analyser.context.sampleRate;
  const binHz = sampleRate / analyser.fftSize;
  const loBin = Math.max(1, Math.floor(20 / binHz));
  const hiBin = Math.max(loBin + 1, Math.ceil(150 / binHz));

  // średnia krocząca energii basu (~1 s) do wykrywania uderzeń względem tła
  const hist = [];
  let lastBeat = 0;
  let kick = 0;       // aktualna siła efektu 0..1 (wygasa)
  let phase = 0;
  let raf = 0;
  let meterCb = null;

  const flashEl = h('div', { style: { position: 'fixed', inset: '0', pointerEvents: 'none', zIndex: '5', background: 'radial-gradient(ellipse at center, color-mix(in srgb, var(--accent) 22%, transparent), transparent 70%)', opacity: '0', transition: 'opacity 120ms ease-out' } });
  document.body.append(flashEl);
  api.onDispose(() => flashEl.remove());

  function targets() {
    const t = cfg().target;
    if (t === 'cover') return [...document.querySelectorAll('#player .np .cover, .q-now .cover, .view-head .big-cover')];
    if (t === 'player') return [document.getElementById('player')].filter(Boolean);
    return [document.getElementById('app')].filter(Boolean);
  }
  let lastTargets = [];
  function apply(transform) {
    const els = targets();
    for (const el of lastTargets) if (!els.includes(el)) el.style.transform = '';
    for (const el of els) { el.style.transform = transform; el.style.willChange = transform ? 'transform' : ''; }
    lastTargets = els;
  }

  function frame(now) {
    raf = requestAnimationFrame(frame);
    if (!api.player.playing || document.hidden) {
      if (kick > 0) { kick = 0; apply(''); }
      return;
    }
    const c = cfg();
    analyser.getByteFrequencyData(data);
    let sum = 0;
    for (let i = loBin; i <= hiBin; i++) sum += data[i];
    const energy = sum / ((hiBin - loBin + 1) * 255); // 0..1
    hist.push(energy);
    if (hist.length > 60) hist.shift();
    const avg = hist.reduce((a, b) => a + b, 0) / hist.length;
    // czułość 0..100 → próg 1.6x..1.05x średniej, minimalna energia 0.55..0.25
    const ratio = 1.6 - (c.sensitivity / 100) * 0.55;
    const minE = 0.55 - (c.sensitivity / 100) * 0.3;
    meterCb?.(energy, avg * ratio, minE);
    if (energy > avg * ratio && energy > minE && now - lastBeat > 110) {
      lastBeat = now;
      const strength = Math.min(1, (energy - minE) / (1 - minE) + 0.35);
      kick = Math.max(kick, strength);
      if (c.flash && strength > 0.8) {
        flashEl.style.opacity = String(Math.min(0.9, strength * 0.8));
        setTimeout(() => (flashEl.style.opacity = '0'), 90);
      }
    }
    kick *= 0.86; // wygasanie
    if (kick < 0.01) {
      if (kick !== 0) { kick = 0; apply(''); }
      return;
    }
    phase += 1.7;
    const amp = (c.intensity / 100) * kick;
    let tr = '';
    if (c.effect === 'shake' || c.effect === 'both') {
      const px = amp * 9;
      const x = Math.sin(phase * 2.3) * px + (Math.random() - 0.5) * px * 0.6;
      const y = Math.cos(phase * 1.9) * px * 0.7 + (Math.random() - 0.5) * px * 0.5;
      const rot = Math.sin(phase * 1.3) * amp * 0.6;
      tr += `translate(${x.toFixed(2)}px, ${y.toFixed(2)}px) rotate(${rot.toFixed(3)}deg) `;
    }
    if (c.effect === 'pulse' || c.effect === 'both') {
      tr += `scale(${(1 + amp * (c.target === 'app' ? 0.012 : 0.06)).toFixed(4)})`;
    }
    apply(tr.trim());
  }
  raf = requestAnimationFrame(frame);
  api.onDispose(() => { cancelAnimationFrame(raf); apply(''); });

  api.commands.register({
    id: 'toggle', label: 'Bouncy: efekt wł./wył.',
    run: () => {
      const off = !api.storage.get('paused', false);
      api.storage.set('paused', off);
      if (off) { cancelAnimationFrame(raf); apply(''); api.ui.toast('Bouncy wstrzymany'); }
      else { raf = requestAnimationFrame(frame); api.ui.toast('Bouncy włączony 🔊'); }
    },
  });
  if (api.storage.get('paused', false)) cancelAnimationFrame(raf);

  // ---- ustawienia ----
  api.ui.addSettings((el) => {
    const c = cfg();
    const range = (key, label, hint) => {
      const r = h('input.range', { type: 'range', min: 0, max: 100, step: 5 });
      r.value = c[key]; api.ui.rangeFill(r);
      const v = h('span', { text: c[key] + '%', style: { width: '44px', textAlign: 'right' } });
      r.addEventListener('input', () => { v.textContent = r.value + '%'; api.ui.rangeFill(r); save({ [key]: Number(r.value) }); });
      return api.ui.settingRow(label, hint, r, v);
    };
    // podgląd energii basu
    const meter = h('div', { style: { position: 'relative', width: '220px', height: '10px', borderRadius: '6px', background: 'var(--hover)', overflow: 'hidden' } });
    const bar = h('i', { style: { position: 'absolute', left: '0', top: '0', bottom: '0', width: '0', background: 'var(--accent)', borderRadius: '6px', transition: 'width 60ms' } });
    const thr = h('i', { style: { position: 'absolute', top: '0', bottom: '0', width: '2px', background: 'var(--text)', left: '50%' } });
    meter.append(bar, thr);
    meterCb = (e, t, m) => {
      if (!meter.isConnected) { meterCb = null; return; }
      bar.style.width = Math.min(100, e * 100) + '%';
      thr.style.left = Math.min(99, Math.max(t, m) * 100) + '%';
    };
    el.append(
      api.ui.settingRow('Efekt', null, api.ui.select([['shake', 'Trzęsienie'], ['pulse', 'Puls'], ['both', 'Trzęsienie + puls']], c.effect, (v) => save({ effect: v }))),
      api.ui.settingRow('Co ma się ruszać', null, api.ui.select([['app', 'Cała aplikacja'], ['player', 'Odtwarzacz'], ['cover', 'Okładki']], c.target, (v) => { apply(''); save({ target: v }); })),
      range('intensity', 'Siła efektu', 'Od delikatnego bujania po trzęsienie ziemi.'),
      range('sensitivity', 'Czułość na bas', 'Wyżej = reaguje na słabsze uderzenia.'),
      api.ui.settingRow('Błysk przy mocnym uderzeniu', null, api.ui.switch(c.flash, (v) => save({ flash: v }))),
      api.ui.settingRow('Bas na żywo', 'Pasek = energia basu, kreska = próg uderzenia (włącz muzykę).', meter),
    );
  });
}
