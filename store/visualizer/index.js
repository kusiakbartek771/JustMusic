// Plugin: wizualizer audio (Web Audio AnalyserNode + canvas).
export default function activate(api) {
  const { h } = api;
  const MODES = [['bars', 'Słupki'], ['wave', 'Fala'], ['circle', 'Okrąg'], ['mirror', 'Lustro']];

  api.ui.addView({
    id: 'view',
    title: 'Wizualizer',
    icon: 'activity',
    render(el) {
      let mode = api.storage.get('mode', 'bars');
      let sensitivity = api.storage.get('sens', 1);
      const wrap = h('div', { style: { position: 'relative', height: '100%', minHeight: '100%' } });
      const canvas = h('canvas', { style: { position: 'absolute', inset: '0', width: '100%', height: '100%' } });
      const bar = h('div', { style: { position: 'absolute', top: '16px', left: '16px', right: '16px', display: 'flex', gap: '6px', zIndex: 2, alignItems: 'center' } });
      const title = h('div', { style: { position: 'absolute', left: '32px', bottom: '28px', zIndex: 2, pointerEvents: 'none' } });
      const drawChips = () => {
        bar.replaceChildren(...MODES.map(([k, l]) => h('button.chip' + (k === mode ? '.on' : ''), {
          text: l, on: { click: () => { mode = k; api.storage.set('mode', k); drawChips(); } },
        })));
        const sens = h('input.range', { type: 'range', min: 0.5, max: 2.5, step: 0.1, style: { width: '120px', marginLeft: 'auto' }, title: 'Czułość' });
        sens.value = sensitivity;
        sens.addEventListener('input', () => { sensitivity = Number(sens.value); api.storage.set('sens', sensitivity); });
        bar.append(sens);
      };
      drawChips();
      const drawTitle = () => {
        const t = api.player.current;
        title.innerHTML = t ? `<div style="font-size:34px;font-weight:800;letter-spacing:-.02em">${api.esc(t.title)}</div><div class="muted" style="font-size:16px">${api.esc(t.artist || '')}</div>` : '';
      };
      drawTitle();
      wrap.append(canvas, bar, title);
      el.style.height = '100%';
      el.append(wrap);

      const analyser = api.audio.getAnalyser();
      if (!analyser) {
        wrap.append(h('div.empty', { text: 'Analizator audio niedostępny.' }));
        return;
      }
      const freq = new Uint8Array(analyser.frequencyBinCount);
      const wave = new Uint8Array(analyser.fftSize);
      const g = canvas.getContext('2d');
      let raf = 0;
      let w = 0, hgt = 0, dpr = 1;
      const resize = () => {
        dpr = Math.min(2, devicePixelRatio || 1);
        w = canvas.clientWidth; hgt = canvas.clientHeight;
        canvas.width = w * dpr; canvas.height = hgt * dpr;
        g.setTransform(dpr, 0, 0, dpr, 0, 0);
      };
      const ro = new ResizeObserver(resize);
      ro.observe(canvas);
      resize();

      const css = getComputedStyle(document.documentElement);
      const color = () => css.getPropertyValue('--accent').trim() || '#7c5cff';
      const text = () => css.getPropertyValue('--text').trim() || '#fff';

      const frame = () => {
        raf = requestAnimationFrame(frame);
        if (document.hidden) return;
        const acc = color();
        g.clearRect(0, 0, w, hgt);
        if (mode === 'wave') {
          analyser.getByteTimeDomainData(wave);
          g.lineWidth = 3;
          g.strokeStyle = acc;
          g.shadowColor = acc; g.shadowBlur = 18;
          g.beginPath();
          for (let i = 0; i < wave.length; i++) {
            const x = (i / (wave.length - 1)) * w;
            const y = hgt / 2 + ((wave[i] - 128) / 128) * (hgt * 0.35) * sensitivity;
            i ? g.lineTo(x, y) : g.moveTo(x, y);
          }
          g.stroke();
          g.shadowBlur = 0;
          return;
        }
        analyser.getByteFrequencyData(freq);
        const n = mode === 'circle' ? 128 : Math.min(160, Math.floor(w / 9));
        // logarytmiczny rozkład pasm
        const vals = new Array(n);
        const maxBin = freq.length * 0.75;
        for (let i = 0; i < n; i++) {
          const a = Math.floor(Math.pow(i / n, 2) * maxBin);
          const b = Math.max(a + 1, Math.floor(Math.pow((i + 1) / n, 2) * maxBin));
          let s = 0;
          for (let k = a; k < b; k++) s += freq[k];
          vals[i] = Math.min(1, (s / (b - a) / 255) * sensitivity);
        }
        if (mode === 'circle') {
          const cx = w / 2, cy = hgt / 2, r = Math.min(w, hgt) * 0.22;
          g.strokeStyle = acc; g.lineCap = 'round'; g.lineWidth = Math.max(2, (2 * Math.PI * r) / n * 0.55);
          for (let i = 0; i < n; i++) {
            const ang = (i / n) * Math.PI * 2 - Math.PI / 2;
            const len = 6 + vals[i] * r * 1.1;
            g.globalAlpha = 0.45 + vals[i] * 0.55;
            g.beginPath();
            g.moveTo(cx + Math.cos(ang) * r, cy + Math.sin(ang) * r);
            g.lineTo(cx + Math.cos(ang) * (r + len), cy + Math.sin(ang) * (r + len));
            g.stroke();
          }
          g.globalAlpha = 1;
          const avg = vals.reduce((a, b) => a + b, 0) / n;
          g.fillStyle = acc; g.globalAlpha = 0.15 + avg * 0.4;
          g.beginPath(); g.arc(cx, cy, r * (0.85 + avg * 0.2), 0, Math.PI * 2); g.fill();
          g.globalAlpha = 1;
          return;
        }
        const gap = 3;
        const bw = (w - gap * (n - 1)) / n;
        const grad = g.createLinearGradient(0, hgt, 0, 0);
        grad.addColorStop(0, acc);
        grad.addColorStop(1, text());
        g.fillStyle = grad;
        for (let i = 0; i < n; i++) {
          const bh = Math.max(2, vals[i] * hgt * (mode === 'mirror' ? 0.42 : 0.75));
          const x = i * (bw + gap);
          if (mode === 'mirror') {
            g.globalAlpha = 0.9;
            g.fillRect(x, hgt / 2 - bh, bw, bh);
            g.globalAlpha = 0.35;
            g.fillRect(x, hgt / 2, bw, bh);
          } else {
            g.globalAlpha = 0.85;
            g.fillRect(x, hgt - bh, bw, bh);
          }
        }
        g.globalAlpha = 1;
      };
      frame();
      const off = api.player.on('track', drawTitle);
      return () => { cancelAnimationFrame(raf); ro.disconnect(); off(); };
    },
  });
}
