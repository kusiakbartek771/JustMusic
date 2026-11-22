// Ekran powitalny – przy pierwszym uruchomieniu (i na życzenie z ustawień).
// Kroki: powitanie → wygląd → układ → silnik muzyki → Twoja muzyka → pluginy → system.
import { S, emit, saveSettings, flush } from './state.js';
import { langPicker } from './langpicker.js';
import { h, esc, btn, toast, switchEl, select } from './ui.js';
import { icon } from './icons.js';
import { PRESETS, ACCENTS, applyAll, applyLayout } from './theme.js';
import { addFolder } from './library.js';
import { storeCatalog, installPlugin, plugins } from './plugins.js';

const THEMES = ['midnight', 'oled', 'fjord', 'grape', 'ocean', 'daylight'];
const LAYOUTS = [
  ['classic', 'Klasyczny', 'Menu po lewej, odtwarzacz na dole, kolejka po prawej', { sidebar: 'left', player: 'bottom', queue: true, sidebarCompact: false, playerStyle: 'full' }],
  ['minimal', 'Minimalny', 'Kompaktowe menu, bez kolejki, cienki pasek postępu', { sidebar: 'left', player: 'bottom', queue: false, sidebarCompact: true, playerStyle: 'minimal' }],
  ['top', 'Odtwarzacz u góry', 'Sterowanie na górze, menu po prawej', { sidebar: 'right', player: 'top', queue: true, sidebarCompact: false, playerStyle: 'full' }],
];
const RECOMMENDED = ['discord', 'lyrics', 'sleeptimer', 'evenmorecolors', 'bouncy'];

export function shouldOnboard() {
  return !S.settings.onboarded;
}

export function openOnboarding() {
  let step = 0;
  const chosenPlugins = new Set(RECOMMENDED.filter((id) => ['lyrics'].includes(id)));
  let catalog = [];
  storeCatalog().then((c) => { catalog = c.items || []; if (step === 5) draw(); }).catch(() => {});

  const root = h('div.ob-bg');
  const card = h('div.ob');
  root.append(card);
  document.getElementById('overlays').append(root);

  const steps = [welcome, look, layout, engine, music, pluginsStep, system];
  const titles = ['Witaj', 'Wygląd', 'Układ', 'Silnik', 'Muzyka', 'Pluginy', 'System'];

  function finish(skipped = false) {
    S.settings.onboarded = true;
    saveSettings();
    flush();
    root.classList.add('out');
    setTimeout(() => root.remove(), 250);
    if (!skipped && chosenPlugins.size) {
      const ids = [...chosenPlugins].filter((id) => !plugins.list.some((p) => p.id === id));
      (async () => {
        for (const id of ids) { try { await installPlugin(id); } catch (e) { toast(`Plugin ${id}: ${e.message}`, { error: true }); } }
        if (ids.length) toast(`Zainstalowano ${ids.length} ${ids.length === 1 ? 'plugin' : 'pluginy'}`);
      })();
    }
    toast(skipped ? 'Wszystko zmienisz później w Ustawieniach' : 'Gotowe – miłego słuchania! 🎵');
  }

  function draw() {
    const dots = h('div.ob-steps', null, ...titles.map((t, i) => h('button.ob-dot' + (i === step ? '.on' : i < step ? '.done' : ''), { title: t, on: { click: () => { step = i; draw(); } } }, h('span', { text: t }))));
    const body = h('div.ob-body');
    steps[step](body);
    const nav = h('div.ob-nav', null,
      step === 0 ? h('button.link', { text: 'Pomiń konfigurację', on: { click: () => finish(true) } }) : btn('Wstecz', { cls: 'ghost', icon: 'chevronLeft', onClick: () => { step--; draw(); } }),
      h('div', { style: { flex: '1' } }),
      step < steps.length - 1
        ? btn(step === 0 ? 'Zaczynamy' : 'Dalej', { primary: true, onClick: () => { step++; draw(); } })
        : btn('Gotowe', { primary: true, icon: 'check', onClick: () => finish(false) }));
    card.replaceChildren(dots, body, nav);
  }

  function welcome(el) {
    el.append(
      h('div.ob-hero', { html: `<div class="logo">${icon('logo')}</div>` }),
      h('h1', { text: 'Witaj w JustMusic' }),
      h('p.lead', { text: 'Muzyka z YouTube, Spotify i Twojego dysku – w jednym, szybkim odtwarzaczu. Ustawmy kilka rzeczy, to zajmie minutę.' }),
      h('div.ob-feats', null, ...[
        ['search', 'Szukaj i słuchaj', 'YouTube i Twoja biblioteka w jednym miejscu'],
        ['download', 'Pobieraj', 'Słuchaj offline, w MP3 lub M4A'],
        ['link', 'Importuj', 'Playlisty ze Spotify i YouTube'],
        ['palette', 'Dopasuj', 'Motywy, układ paneli i pluginy'],
      ].map(([ic, t, d]) => h('div.ob-feat', { html: `${icon(ic)}<b>${esc(t)}</b><small>${esc(d)}</small>` }))),
      h('div.ob-lang', null, langPicker()),
    );
  }

  function look(el) {
    const T = S.settings.theme;
    const grid = h('div.ob-themes');
    for (const id of THEMES) {
      const p = PRESETS[id];
      grid.append(h('button.ob-theme' + (T.preset === id ? '.on' : ''), {
        on: { click: () => { T.preset = id; T.custom = {}; applyAll(); saveSettings(); draw(); } },
      }, h('div.prev', { style: { background: p.bg } }, h('i', { style: { background: p.surface } }), h('i', { style: { background: p.accent } })), h('span', { text: p.name })));
    }
    const sw = h('div.accent-swatches');
    for (const c of ACCENTS) sw.append(h('button', { style: { background: c }, on: { click: () => { T.custom = { ...T.custom, accent: c }; applyAll(); saveSettings(); } } }));
    el.append(h('h2', { text: 'Wybierz wygląd' }), h('p.lead', { text: 'Motyw zmieni się od razu. Więcej motywów i własne kolory znajdziesz w Ustawieniach.' }), grid,
      h('div.ob-row', null, h('b', { text: 'Kolor akcentu' }), sw),
      h('div.ob-row', null, h('b', { text: 'Tło z okładki utworu' }), switchEl(T.ambient, (v) => { T.ambient = v; applyAll(); saveSettings(); })));
  }

  function layout(el) {
    const L = S.settings.layout;
    const cur = LAYOUTS.find(([, , , v]) => Object.entries(v).every(([k, x]) => L[k] === x))?.[0];
    const grid = h('div.ob-layouts');
    for (const [id, name, desc, v] of LAYOUTS) {
      const prev = h('div.ob-lp.' + id, null, h('i.s'), h('i.m'), h('i.q'), h('i.p'));
      grid.append(h('button.ob-layout' + (cur === id ? '.on' : ''), {
        on: { click: () => { Object.assign(L, v); applyLayout(); saveSettings(); emit('settings'); emit('queuePanel'); draw(); } },
      }, prev, h('b', { text: name }), h('small', { text: desc })));
    }
    el.append(h('h2', { text: 'Układ aplikacji' }), h('p.lead', { text: 'Każdy panel możesz później przesunąć, schować lub zmienić jego szerokość.' }), grid,
      h('div.ob-row', null, h('b', { text: 'Przyciski okna' }), select([['auto', 'Automatycznie'], ['right', 'Po prawej (Windows / Linux)'], ['left', 'Po lewej (macOS)']], ['right', 'left'].includes(L.windowButtons) ? L.windowButtons : 'auto', (v) => { L.windowButtons = v; saveSettings(); toast('Zmiana przycisków okna będzie widoczna po ponownym uruchomieniu'); })));
  }

  function engine(el) {
    const box = h('div.ob-engine');
    const render = async () => {
      let st = S.ytStatus;
      try { st = S.ytStatus = await window.jm.yt.status(); } catch {}
      st ||= {};
      const item = (ok, title, desc, action) => h('div.ob-check' + (ok ? '.ok' : ''), null, h('span.ob-tick', { html: icon(ok ? 'check' : 'download') }), h('div', { html: `<b>${title}</b><small>${desc}</small>` }), action || h('span'));
      const prog = h('div.progress', { style: { width: '120px', display: 'none' } }, h('i', { style: { width: '0%' } }));
      const ytBtn = st.ready ? null : btn('Zainstaluj', { primary: true, cls: 'sm', onClick: async () => {
        ytBtn.disabled = true; prog.style.display = '';
        const off = window.jm.yt.onInstallProgress((p) => (prog.firstChild.style.width = Math.round(p * 100) + '%'));
        try { await window.jm.yt.install(); toast('yt-dlp gotowy ✓'); emit('yt:status'); } catch (e) { toast(e.message, { error: true }); }
        off(); render();
      } });
      const prog2 = h('div.progress', { style: { width: '120px', display: 'none' } }, h('i', { style: { width: '0%' } }));
      const ffBtn = st.ffmpeg ? null : btn('Pobierz', { cls: 'sm', onClick: async () => {
        ffBtn.disabled = true; prog2.style.display = '';
        const off = window.jm.yt.onFfmpegProgress((p) => (prog2.firstChild.style.width = p.percent + '%'));
        try { S.ytStatus = await window.jm.yt.installFfmpeg(); toast('ffmpeg gotowy ✓'); } catch (e) { toast(e.message, { error: true }); }
        off(); render();
      } });
      box.replaceChildren(
        item(st.ready, 'yt-dlp – silnik YouTube', st.ready ? `Gotowy · wersja ${esc(st.version || '')}` : 'Wymagany do wyszukiwania, słuchania i pobierania z YouTube i Spotify. Kilka sekund.', h('div.ob-act', null, prog, ytBtn)),
        item(!!st.ffmpeg, 'ffmpeg – konwersja audio', st.ffmpeg ? 'Gotowy' : 'Opcjonalny: pobieranie w MP3/OPUS z okładkami i tagami. Bez niego pliki zapisują się w M4A.', h('div.ob-act', null, prog2, ffBtn)),
      );
    };
    render();
    el.append(h('h2', { text: 'Silnik muzyki' }), h('p.lead', { text: 'JustMusic korzysta z darmowych narzędzi open source. Pobierają się z oficjalnych źródeł.' }), box);
  }

  function music(el) {
    const lib = S.settings.library;
    const folders = h('div.ob-folders');
    const drawFolders = () => folders.replaceChildren(...(lib.folders.length ? lib.folders.map((f) => h('div.ob-folder', { html: `${icon('folder')}<span>${esc(f)}</span>` })) : [h('div.muted', { text: 'Nie dodano jeszcze folderu – to opcjonalne.' })]));
    drawFolders();
    const dl = S.settings.downloads;
    const dirLabel = h('span.code', { text: dl.dir });
    el.append(h('h2', { text: 'Twoja muzyka' }), h('p.lead', { text: 'Masz pliki z muzyką na dysku? Dodaj folder, a JustMusic pokaże je w Bibliotece.' }),
      folders,
      btn('Dodaj folder z muzyką', { icon: 'folderPlus', onClick: async () => { await addFolder(); drawFolders(); } }),
      h('div.ob-row', { style: { marginTop: '22px' } }, h('div', null, h('b', { text: 'Folder na pobrane utwory' }), h('div', null, dirLabel)),
        btn('Zmień', { cls: 'sm', onClick: async () => { const d = await window.jm.dialog.folder('Folder na pobraną muzykę'); if (d) { dl.dir = d; dirLabel.textContent = d; saveSettings(); } } })),
      h('div.ob-row', null, h('b', { text: 'Format pobierania' }), select([['m4a', 'M4A (AAC) – zalecany'], ['mp3', 'MP3'], ['opus', 'OPUS']], dl.format, (v) => { dl.format = v; saveSettings(); })));
  }

  function pluginsStep(el) {
    const list = h('div.ob-plugins');
    const items = catalog.length ? catalog.filter((p) => RECOMMENDED.includes(p.id)) : [];
    for (const p of items) {
      const installed = plugins.list.some((x) => x.id === p.id);
      const on = installed || chosenPlugins.has(p.id);
      const row = h('label.ob-plugin' + (on ? '.on' : ''), null,
        h('span.ob-pic', { html: icon(p.icon || 'puzzle') }),
        h('div', { html: `<b>${esc(p.name)}</b><small>${esc(p.short || '')}</small>` }),
        installed ? h('span.muted', { text: 'zainstalowany', style: { fontSize: '12px' } }) : switchEl(on, (v) => { v ? chosenPlugins.add(p.id) : chosenPlugins.delete(p.id); row.classList.toggle('on', v); }));
      list.append(row);
    }
    if (!items.length) list.append(h('div.spinner-row', null, h('div.loading-spin'), 'Wczytywanie sklepu…'));
    el.append(h('h2', { text: 'Pluginy' }), h('p.lead', { text: 'JustMusic startuje bez dodatków. Zaznacz te, które chcesz – zainstalują się po zakończeniu. Wszystkie znajdziesz w Ustawienia → Pluginy.' }), list);
  }

  function system(el) {
    const sys = S.settings.system;
    const auto = h('div');
    window.jm.system.getAutostart().then((a) => {
      auto.replaceChildren(h('div.ob-row', null, h('div', { html: '<b>Uruchamiaj przy starcie systemu</b><small>JustMusic włączy się po zalogowaniu.</small>' }),
        switchEl(a.enabled, async (v) => { try { await window.jm.system.setAutostart(v, v); } catch (e) { toast(e.message, { error: true }); } })));
    }).catch(() => {});
    el.append(h('h2', { text: 'Integracja z systemem' }), h('p.lead', { text: 'Ostatni krok. Wszystko to zmienisz też w Ustawienia → System.' }),
      auto,
      h('div.ob-row', null, h('div', { html: '<b>Ikona w zasobniku</b><small>Sterowanie muzyką z ikony obok zegara.</small>' }), switchEl(sys.tray, (v) => { sys.tray = v; saveSettings(); })),
      h('div.ob-row', null, h('div', { html: '<b>Zamykanie do zasobnika</b><small>Krzyżyk chowa okno, muzyka gra dalej.</small>' }), switchEl(sys.closeToTray, (v) => { sys.closeToTray = v; if (v) sys.tray = true; saveSettings(); })),
      h('div.ob-row', null, h('div', { html: '<b>Automatyczne aktualizacje</b><small>Nowe wersje instalują się same, bez przerywania muzyki.</small>' }), switchEl(S.settings.updates.autoInstall, (v) => { S.settings.updates.autoInstall = v; saveSettings(); })));
  }

  draw();
}
