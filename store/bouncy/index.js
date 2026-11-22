// Plugin: Bouncy – aplikacja trzęsie się / pulsuje w rytm muzyki.
// Dwa tryby:
//  • „Rytm piosenki” – z narastania dźwięku (onsetów) liczy tempo (BPM) i fazę taktu, potem trzęsie
//    na każde uderzenie rytmu – także w utworach bez mocnego basu;
//  • „Uderzenia basu” – reaguje na nagłe skoki energii w paśmie basu.
// Wykrywanie jest względne (automatyczne wzmocnienie), więc działa przy każdej głośności
// i z wyrównywaniem głośności.
export default function activate(api) {
  const { h } = api;
  const D = { mode: 'rhythm', effect: 'shake', target: 'app', intensity: 60, sensitivity: 55, flash: true };
  const cfg = () => ({ ...D, ...api.storage.get('cfg', {}) });
  const save = (patch) => api.storage.set('cfg', { ...cfg(), ...patch });

  const shared = api.audio.getAnalyser();
  if (!shared) { api.ui.toast('Bouncy: analizator audio niedostępny', { error: true }); return; }
  // własny, szybki analizator (wspólny jest mocno wygładzony – rozmywa uderzenia)
  const ac = shared.context;
  const analyser = ac.createAnalyser();
  analyser.fftSize = 1024;
  analyser.smoothingTimeConstant = 0;
  shared.connect(analyser);
  api.onDispose(() => { try { shared.disconnect(analyser); } catch {} });

  const N = analyser.frequencyBinCount;
  const data = new Uint8Array(N);
  const prev = new Float32Array(N);
  const binHz = ac.sampleRate / analyser.fftSize;
  const bassHi = Math.max(2, Math.ceil(180 / binHz));
  const fluxHi = Math.min(N - 1, Math.ceil(5000 / binHz));

  // --- obwiednia onsetów: próbki co 10 ms z ostatnich 8 s ---
  const STEP = 10;
  const LEN = 800;
  const env = new Float32Array(LEN);
  let envPos = 0;          // indeks bieżącej próbki (rośnie bez końca)
  let envT = 0;            // czas bieżącej próbki
  let fluxPeak = 1e-3, bassPeak = 1e-3;
  const bassHist = [];

  // --- tempo ---
  let period = 0;          // ms między uderzeniami (0 = nieznane)
  let confidence = 0;
  let nextBeat = 0;
  let lastTempo = 0;
  let bpmShown = 0;

  let lastBeat = 0;
  let lastFrame = 0;
  let activity = 0;
  let kick = 0;       // aktualna siła efektu 0..1 (wygasa)
  let phase = 0;
  let raf = 0;
  let meterCb = null;

  const envAt = (i) => env[((i % LEN) + LEN) % LEN];

  // Autokorelacja obwiedni: najlepszy okres w zakresie 70–180 BPM, potem faza
  function estimateTempo() {
    const n = Math.min(envPos, LEN - 1);
    if (n < 300) return;
    const end = envPos;
    let mean = 0;
    for (let i = end - n; i < end; i++) mean += envAt(i);
    mean /= n;
    const minL = Math.round(60000 / 180 / STEP), maxL = Math.round(60000 / 70 / STEP);
    let best = 0, bestL = 0, sum = 0, cnt = 0;
    const scores = [];
    for (let L = minL; L <= maxL; L++) {
      let sc = 0;
      for (let i = end - n + L; i < end; i++) sc += (envAt(i) - mean) * (envAt(i - L) - mean);
      sc /= n - L;
      // lekka preferencja typowych temp (ok. 120 BPM)
      const bpm = 60000 / (L * STEP);
      const w = Math.exp(-0.5 * Math.pow(Math.log2(bpm / 120) / 0.9, 2));
      scores[L] = sc;
      const ws = sc * (0.6 + 0.4 * w);
      if (ws > best) { best = ws; bestL = L; }
      if (sc > 0) { sum += sc; cnt++; }
    }
    if (!bestL || best <= 0) { confidence *= 0.8; return; }
    // dopracowanie okresu między sąsiednimi przesunięciami
    const a = scores[bestL - 1] ?? 0, b = scores[bestL], c2 = scores[bestL + 1] ?? 0;
    const den = a - 2 * b + c2;
    const off = den ? Math.max(-0.5, Math.min(0.5, 0.5 * (a - c2) / den)) : 0;
    const newPeriod = (bestL + off) * STEP;
    confidence = cnt ? Math.min(1, (scores[bestL] / (sum / cnt) - 1) / 2) : 0;
    period = period && Math.abs(newPeriod - period) / period < 0.08 ? period * 0.7 + newPeriod * 0.3 : newPeriod;
    // faza: przesunięcie, przy którym uderzenia najlepiej pokrywają się z onsetami
    const P = period / STEP;
    let bestPh = 0, bestPhS = -1;
    for (let o = 0; o < Math.round(P); o++) {
      let sc = 0;
      for (let k = 0; k < 8; k++) {
        const i = Math.round(end - 1 - o - k * P);
        if (i <= end - n) break;
        sc += envAt(i) + 0.5 * (envAt(i - 1) + envAt(i + 1));
      }
      if (sc > bestPhS) { bestPhS = sc; bestPh = o; }
    }
    const lastOnBeat = envT - bestPh * STEP;
    let nb = lastOnBeat + period;
    while (nb < performance.now() - period * 0.25) nb += period;
    // nie cofaj się do uderzenia, które już było
    while (nb < lastBeat + period * 0.6) nb += period;
    // płynna korekta, żeby uderzenia nie „skakały”
    if (nextBeat && Math.abs(nb - nextBeat) < period * 0.5) nextBeat += (nb - nextBeat) * 0.35;
    else nextBeat = nb;
    bpmShown = Math.round(60000 / period);
  }

  function resetAnalysis() {
    env.fill(0); envPos = 0; period = 0; confidence = 0; nextBeat = 0; bpmShown = 0;
    fluxPeak = bassPeak = 1e-3; bassHist.length = 0; prev.fill(0); activity = 0;
  }
  api.player.on?.('track', resetAnalysis);

  const flashEl = h('div', { style: { position: 'fixed', inset: '0', pointerEvents: 'none', zIndex: '5', background: 'radial-gradient(ellipse at center, color-mix(in srgb, var(--accent) 22%, transparent), transparent 70%)', opacity: '0', transition: 'opacity 120ms ease-out' } });
  document.body.append(flashEl);
  api.onDispose(() => flashEl.remove());

  function hit(strength, c) {
    kick = Math.max(kick, strength);
    if (c.flash && strength > 0.8) {
      flashEl.style.opacity = String(Math.min(0.9, strength * 0.8));
      setTimeout(() => (flashEl.style.opacity = '0'), 90);
    }
  }

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
    // spectral flux: suma wzrostów widma (niskie pasma ważniejsze)
    let flux = 0, bass = 0;
    for (let i = 1; i <= fluxHi; i++) {
      const v = data[i];
      const d = v - prev[i];
      prev[i] = v;
      if (d > 0) flux += i <= bassHi ? d * 2 : d;
      if (i <= bassHi) bass += d > 0 ? d : 0;
    }
    // automatyczne wzmocnienie – próg nie zależy od głośności utworu
    fluxPeak = Math.max(flux, fluxPeak * 0.997);
    bassPeak = Math.max(bass, bassPeak * 0.997);
    const nf = fluxPeak > 1 ? flux / fluxPeak : 0;
    const nb = bassPeak > 1 ? bass / bassPeak : 0;
    activity = Math.max(nf, activity * 0.993); // czy w ogóle coś się dzieje (cisza = brak efektu)

    // obwiednia co 10 ms
    if (!envT) envT = now;
    while (envT + STEP <= now) {
      envT += STEP;
      envPos++;
      env[envPos % LEN] = 0;
    }
    env[envPos % LEN] = Math.max(env[envPos % LEN], nf);
    if (now - lastTempo > 1000) { lastTempo = now; estimateTempo(); }

    const sens = c.sensitivity / 100;
    bassHist.push(nb);
    if (bassHist.length > 45) bassHist.shift();
    const avg = bassHist.reduce((a, b) => a + b, 0) / bassHist.length;
    const thr = Math.max(avg * (1.9 - sens * 0.7), 0.42 - sens * 0.3);
    meterCb?.(nb, thr, c.mode === 'rhythm' ? bpmShown : 0, confidence);

    if (c.mode === 'rhythm' && period && confidence > 0.12 - sens * 0.08 && activity > 0.15) {
      // uderzenia z tempa: na przewidywany takt (siła zależy od tego, jak mocno brzmi)
      if (nextBeat && now >= nextBeat) {
        const local = Math.max(nf, envAt(envPos - 1), envAt(envPos - 2));
        hit(Math.min(1, 0.45 + 0.35 * confidence + 0.4 * local), c);
        lastBeat = now;
        while (nextBeat <= now) nextBeat += period;
      }
    } else if (nb > thr && now - lastBeat > 120) {
      // uderzenia basu (także zastępczo, zanim tempo zostanie wykryte)
      lastBeat = now;
      hit(Math.min(1, 0.35 + (nb - thr) / Math.max(0.05, 1 - thr)), c);
    }
    // wygasanie zależne od czasu (ok. 80 ms) – każde uderzenie jest osobnym „szarpnięciem”
    const dt = lastFrame ? Math.min(100, now - lastFrame) : 16;
    lastFrame = now;
    kick *= Math.exp(-dt / 80);
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
    const tempo = h('span', { text: '–', style: { minWidth: '120px', fontVariantNumeric: 'tabular-nums', color: 'var(--text-dim)' } });
    meterCb = (e, t, bpm, conf) => {
      if (!meter.isConnected) { meterCb = null; return; }
      bar.style.width = Math.min(100, e * 100) + '%';
      thr.style.left = Math.min(99, t * 100) + '%';
      tempo.textContent = bpm ? `${bpm} BPM · ${Math.round(conf * 100)}%` : '–';
    };
    el.append(
      api.ui.settingRow('Reaguj na', 'Rytm piosenki wykrywa tempo i trzęsie na każde uderzenie – także gdy bas jest słaby.', api.ui.select([['rhythm', 'Rytm piosenki (tempo)'], ['bass', 'Uderzenia basu']], c.mode, (v) => save({ mode: v }))),
      api.ui.settingRow('Efekt', null, api.ui.select([['shake', 'Trzęsienie'], ['pulse', 'Puls'], ['both', 'Trzęsienie + puls']], c.effect, (v) => save({ effect: v }))),
      api.ui.settingRow('Co ma się ruszać', null, api.ui.select([['app', 'Cała aplikacja'], ['player', 'Odtwarzacz'], ['cover', 'Okładki']], c.target, (v) => { apply(''); save({ target: v }); })),
      range('intensity', 'Siła efektu', 'Od delikatnego bujania po trzęsienie ziemi.'),
      range('sensitivity', 'Czułość', 'Wyżej = reaguje na słabsze uderzenia i mniej wyraźny rytm.'),
      api.ui.settingRow('Błysk przy mocnym uderzeniu', null, api.ui.switch(c.flash, (v) => save({ flash: v }))),
      api.ui.settingRow('Bas na żywo', 'Pasek = energia basu, kreska = próg uderzenia (włącz muzykę).', meter),
      api.ui.settingRow('Wykryte tempo', 'Tempo piosenki i pewność wykrycia (w trybie „Rytm piosenki”).', tempo),
    );
  });
}
