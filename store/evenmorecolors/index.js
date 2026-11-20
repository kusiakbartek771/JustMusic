// Plugin: EvenMoreColors – dodatkowe motywy i generator kolorów.
export default function activate(api) {
  const { h } = api;

  // ---- kolory ----
  function hsl(hh, s, l) {
    s /= 100; l /= 100;
    const k = (n) => (n + hh / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    return '#' + [f(0), f(8), f(4)].map((x) => Math.round(x * 255).toString(16).padStart(2, '0')).join('');
  }
  const lum = (hex) => {
    const [r, g, b] = hex.slice(1).match(/.{2}/g).map((x) => parseInt(x, 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const onAccent = (hex) => (lum(hex) > 0.4 ? '#111111' : '#ffffff');

  // Paleta z odcienia (ciemna lub jasna)
  function palette(hue, { light = false, sat = 70, accentHue = hue, tint = 22, name } = {}) {
    const accent = light ? hsl(accentHue, Math.min(95, sat + 15), 48) : hsl(accentHue, Math.min(95, sat + 15), 64);
    const v = light
      ? { bg: hsl(hue, tint, 95), surface: hsl(hue, tint, 99), 'surface-2': hsl(hue, tint, 93), elevated: '#ffffff', text: hsl(hue, 25, 12), 'text-dim': hsl(hue, 10, 42), border: hsl(hue, tint, 87) }
      : { bg: hsl(hue, tint, 6), surface: hsl(hue, tint, 9), 'surface-2': hsl(hue, tint - 2, 13), elevated: hsl(hue, tint - 4, 17), text: hsl(hue, 25, 94), 'text-dim': hsl(hue, 12, 62), border: hsl(hue, tint - 4, 16) };
    return { name, ...v, accent, 'accent-text': onAccent(accent) };
  }

  const THEMES = {
    emc_aurora: palette(165, { name: 'Aurora', accentHue: 150, sat: 70 }),
    emc_nebula: palette(265, { name: 'Nebula', accentHue: 290, sat: 75 }),
    emc_volcano: palette(10, { name: 'Volcano', accentHue: 18, sat: 85, tint: 18 }),
    emc_glacier: palette(205, { name: 'Glacier', accentHue: 195, sat: 70 }),
    emc_matcha: palette(95, { name: 'Matcha', accentHue: 85, sat: 55, tint: 16 }),
    emc_amber: palette(35, { name: 'Amber', accentHue: 40, sat: 90, tint: 16 }),
    emc_sakura: palette(335, { name: 'Sakura Night', accentHue: 340, sat: 75 }),
    emc_deepsea: palette(220, { name: 'Deep Sea', accentHue: 175, sat: 70, tint: 35 }),
    emc_royal: palette(240, { name: 'Royal', accentHue: 48, sat: 80, tint: 30 }),
    emc_mint: palette(160, { name: 'Mint Cream', light: true, accentHue: 165, sat: 60, tint: 30 }),
    emc_lavender: palette(260, { name: 'Lavender', light: true, accentHue: 265, sat: 60, tint: 35 }),
    emc_peach: palette(22, { name: 'Peach', light: true, accentHue: 14, sat: 75, tint: 40 }),
    emc_sky: palette(205, { name: 'Sky', light: true, accentHue: 210, sat: 75, tint: 40 }),
    emc_paper: palette(45, { name: 'Paper', light: true, accentHue: 220, sat: 55, tint: 18 }),
    emc_citrus: palette(60, { name: 'Citrus', accentHue: 75, sat: 85, tint: 10 }),
    emc_cyberpunk: { name: 'Cyberpunk', bg: '#0a0612', surface: '#120b1f', 'surface-2': '#1a1030', elevated: '#22163f', text: '#f8f0ff', 'text-dim': '#9b8ab8', accent: '#fcee0a', 'accent-text': '#111111', border: '#2a1b48' },
    emc_synthwave: { name: 'Synthwave', bg: '#140b22', surface: '#1c1030', 'surface-2': '#26163f', elevated: '#301d4f', text: '#ffe9ff', 'text-dim': '#b48fc9', accent: '#ff2e97', 'accent-text': '#ffffff', border: '#3a2259' },
    emc_matrix: { name: 'Matrix', bg: '#000400', surface: '#020a03', 'surface-2': '#051307', elevated: '#08200c', text: '#c8ffc8', 'text-dim': '#4f9a57', accent: '#00ff41', 'accent-text': '#001a06', border: '#0b2a10' },
    emc_coffee: { name: 'Espresso', bg: '#14100d', surface: '#1c1612', 'surface-2': '#251d17', elevated: '#2f251e', text: '#f3e9df', 'text-dim': '#a8968a', accent: '#d4a373', 'accent-text': '#1a1008', border: '#33281f' },
    emc_slate: { name: 'Slate', bg: '#0f1115', surface: '#161a20', 'surface-2': '#1d222a', elevated: '#252b35', text: '#e6e9ef', 'text-dim': '#8a93a3', accent: '#94a3b8', 'accent-text': '#0f1115', border: '#272d38' },
    emc_contrast: { name: 'Wysoki kontrast', bg: '#000000', surface: '#000000', 'surface-2': '#0d0d0d', elevated: '#1a1a1a', text: '#ffffff', 'text-dim': '#d0d0d0', accent: '#ffff00', 'accent-text': '#000000', border: '#ffffff' },
    emc_contrastlight: { name: 'Wysoki kontrast (jasny)', bg: '#ffffff', surface: '#ffffff', 'surface-2': '#f2f2f2', elevated: '#ffffff', text: '#000000', 'text-dim': '#333333', accent: '#0040ff', 'accent-text': '#ffffff', border: '#000000' },
    emc_rosegold: { name: 'Rose Gold', bg: '#1a1213', surface: '#22181a', 'surface-2': '#2c1f22', elevated: '#36272a', text: '#fbeff0', 'text-dim': '#b8999d', accent: '#e8a598', 'accent-text': '#2a1412', border: '#3a2a2d' },
    emc_ocean_light: palette(190, { name: 'Lagoon', light: true, accentHue: 185, sat: 80, tint: 45 }),
  };
  for (const [id, t] of Object.entries(THEMES)) api.themes.add(id, t);

  // ---- generator ----
  const randomTheme = () => {
    const sat = api.storage.get('sat', 70);
    const hue = Math.floor(Math.random() * 360);
    const light = api.storage.get('allowLight', false) && Math.random() < 0.3;
    const accentHue = Math.random() < 0.5 ? hue : (hue + 120 + Math.floor(Math.random() * 120)) % 360;
    const p = palette(hue, { light, sat, accentHue, tint: 15 + Math.floor(Math.random() * 20) });
    delete p.name;
    api.themes.applyCustom(p);
    api.ui.toast('Nowy losowy motyw 🎨');
  };

  function coverHue() {
    return new Promise((resolve) => {
      const t = api.player.current;
      if (!t?.thumb) return resolve(null);
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        try {
          const c = document.createElement('canvas');
          c.width = c.height = 24;
          const g = c.getContext('2d', { willReadFrequently: true });
          g.drawImage(img, 0, 0, 24, 24);
          const d = g.getImageData(0, 0, 24, 24).data;
          const bins = new Array(36).fill(0);
          for (let i = 0; i < d.length; i += 4) {
            const r = d[i] / 255, gg = d[i + 1] / 255, b = d[i + 2] / 255;
            const max = Math.max(r, gg, b), min = Math.min(r, gg, b);
            const s = max ? (max - min) / max : 0;
            if (s < 0.2 || max < 0.2) continue;
            let hh = 0;
            if (max === r) hh = ((gg - b) / (max - min)) % 6;
            else if (max === gg) hh = (b - r) / (max - min) + 2;
            else hh = (r - gg) / (max - min) + 4;
            hh = (hh * 60 + 360) % 360;
            bins[Math.floor(hh / 10)] += s * max;
          }
          const best = bins.indexOf(Math.max(...bins));
          resolve(Math.max(...bins) > 0 ? best * 10 + 5 : null);
        } catch { resolve(null); }
      };
      img.onerror = () => resolve(null);
      img.src = t.thumb.replace('/mqdefault.jpg', '/hqdefault.jpg');
    });
  }

  async function themeFromCover(silent = false) {
    const hue = await coverHue();
    if (hue === null) { if (!silent) api.ui.toast('Nie udało się odczytać kolorów okładki', { error: true }); return; }
    const p = palette(hue, { sat: api.storage.get('sat', 70), tint: 24 });
    delete p.name;
    api.themes.applyCustom(p);
    if (!silent) api.ui.toast('Motyw z okładki 🎨');
  }

  api.player.on('track', () => {
    const mode = api.storage.get('perTrack', 'off');
    if (mode === 'cover') setTimeout(() => themeFromCover(true), 300);
    else if (mode === 'random') {
      const hue = Math.floor(Math.random() * 360);
      const acc = hsl(hue, Math.min(95, api.storage.get('sat', 70) + 15), 62);
      api.themes.applyCustom({ ...api.storage.get('_keep', {}), accent: acc, 'accent-text': onAccent(acc) });
    }
  });

  api.commands.register({ id: 'random', label: 'Losowy motyw', run: randomTheme });
  api.commands.register({ id: 'cover', label: 'Motyw z okładki', run: () => themeFromCover() });

  api.ui.addSettings((el) => {
    const sat = h('input.range', { type: 'range', min: 20, max: 95, step: 5 });
    sat.value = api.storage.get('sat', 70); api.ui.rangeFill(sat);
    const satV = h('span', { text: sat.value + '%', style: { width: '44px', textAlign: 'right' } });
    sat.addEventListener('input', () => { satV.textContent = sat.value + '%'; api.ui.rangeFill(sat); });
    sat.addEventListener('change', () => api.storage.set('sat', Number(sat.value)));
    el.append(
      api.ui.settingRow('Generator motywów', 'Losowa, spójna paleta albo kolory z okładki aktualnego utworu.',
        api.ui.button('Losowy motyw', { icon: 'sparkles', cls: 'sm', onClick: randomTheme }),
        api.ui.button('Z okładki', { icon: 'disc', cls: 'sm', onClick: () => themeFromCover() })),
      api.ui.settingRow('Nasycenie kolorów', null, sat, satV),
      api.ui.settingRow('Losuj też jasne motywy', null, api.ui.switch(api.storage.get('allowLight', false), (v) => api.storage.set('allowLight', v))),
      api.ui.settingRow('Przy każdym utworze', 'Automatycznie zmieniaj kolory, gdy zaczyna się nowy utwór.',
        api.ui.select([['off', 'Bez zmian'], ['random', 'Nowy kolor akcentu'], ['cover', 'Cały motyw z okładki']], api.storage.get('perTrack', 'off'), (v) => {
          if (v === 'random') api.storage.set('_keep', { ...(api.themes.vars) });
          api.storage.set('perTrack', v);
        })),
      api.ui.settingRow(`${Object.keys(THEMES).length} dodatkowych motywów`, 'Znajdziesz je w Motyw i kolory → Motywy z pluginów.',
        api.ui.button('Pokaż', { cls: 'sm ghost', onClick: () => api.ui.navigate('settings', 'appearance') })),
    );
  });
}
