// Widok ustawień – cała customizacja aplikacji.
import { S, emit, saveSettings, saveData, DEFAULT_SETTINGS } from './state.js';
import { h, esc, btn, iconBtn, switchEl, select, rangeFill, toast, confirmDialog, fmtBytes, spinner } from './ui.js';
import { icon } from './icons.js';
import { registerView, navigate, refresh } from './router.js';
import { PRESETS, ACCENTS, FONTS, VAR_KEYS, themeVars, applyAll, applyLayout, applyTheme, applyStyle, updateDynamicAccent, setAmbient } from './theme.js';
import { P } from './player.js';
import { eqPanel } from './playerbar.js';
import { plugins, setPluginEnabled, reloadPlugins, storeCatalog, installPlugin, uninstallPlugin } from './plugins.js';
import { flush } from './state.js';
import { updatesPanel } from './updates.js';
import { addFolder, removeFolder, rescan } from './library.js';

const TABS = [
  ['appearance', 'palette', 'Motyw i kolory'],
  ['style', 'brush', 'Styl'],
  ['layout', 'layout', 'Układ paneli'],
  ['playback', 'sliders', 'Odtwarzanie'],
  ['downloads', 'download', 'Pobieranie'],
  ['youtube', 'video', 'YouTube'],
  ['spotify', 'link', 'Spotify'],
  ['library', 'folder', 'Biblioteka'],
  ['system', 'monitor', 'System'],
  ['plugins', 'store', 'Pluginy'],
  ['shortcuts', 'keyboard', 'Skróty'],
  ['about', 'info', 'O aplikacji'],
];

let lastTab = 'appearance';
const openPluginSettings = new Set(); // rozwinięte panele ustawień pluginów

const changed = (fn) => () => { fn?.(); saveSettings(); emit('settings'); };

function row(label, hint, ...ctl) {
  return h('div.setting', null, h('div.lbl', { html: `<b>${esc(label)}</b>${hint ? `<small>${hint}</small>` : ''}` }), h('div.ctl', null, ...ctl));
}
function group(title, ...rows) {
  return h('div.group', null, title ? h('div.group-title', { text: title }) : null, ...rows);
}
function toggleRow(label, hint, obj, key, after) {
  return row(label, hint, switchEl(obj[key], (v) => { obj[key] = v; changed(after)(); }));
}
function rangeRow(label, hint, obj, key, min, max, step, unit, after) {
  const r = h('input.range', { type: 'range', min, max, step });
  r.value = obj[key];
  rangeFill(r);
  const val = h('span', { text: obj[key] + unit, style: { width: '52px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' } });
  r.addEventListener('input', () => { obj[key] = Number(r.value); val.textContent = r.value + unit; rangeFill(r); after?.(); });
  r.addEventListener('change', () => { saveSettings(); emit('settings'); });
  return row(label, hint, r, val);
}
function selectRow(label, hint, obj, key, options, after) {
  return row(label, hint, select(options, obj[key], (v) => { obj[key] = isNaN(v) || v === '' ? v : Number(v); changed(after)(); }));
}
function textRow(label, hint, obj, key, placeholder = '', type = 'text', after) {
  const i = h('input.input', { type, placeholder, style: { width: '280px' } });
  i.value = obj[key] || '';
  i.addEventListener('change', () => { obj[key] = i.value.trim(); changed(after)(); });
  return row(label, hint, i);
}

registerView('settings', (root, tab) => {
  tab = tab || lastTab;
  lastTab = tab;
  const nav = h('div.settings-nav', null, h('h2', { text: 'Ustawienia' }));
  for (const [k, ic, label] of TABS) {
    nav.append(h('button.nav-item' + (k === tab ? '.on' : ''), { html: `${icon(ic)}<span>${esc(label)}</span>`, on: { click: () => navigate('settings', k, { replace: true }) } }));
  }
  const body = h('div.settings-body');
  root.append(h('div.settings', null, nav, body));
  const fn = SECTIONS[tab] || SECTIONS.appearance;
  return fn(body);
});

const SECTIONS = {
  // ---------------- motyw ----------------
  appearance(body) {
    const T = S.settings.theme;
    body.append(h('h2', { text: 'Motyw i kolory' }), h('p', { text: 'Wybierz gotowy motyw, a potem dopasuj każdy kolor do siebie.' }));

    const grid = h('div.theme-grid');
    const pluginGrid = h('div.theme-grid');
    for (const [k, p] of Object.entries(PRESETS)) {
      const target = p.plugin ? pluginGrid : grid;
      const card = h('div.theme-card' + (T.preset === k ? '.on' : ''), { on: { click: () => { T.preset = k; T.custom = {}; changed()(); refresh(); } } });
      card.append(h('div.prev', { style: { background: p.bg } },
        h('i', { style: { background: p.surface } }),
        h('div.main', { style: { background: p.surface } },
          h('b', { style: { background: p.text, width: '70%' } }),
          h('b', { style: { background: p['text-dim'], width: '45%' } }),
          h('b', { style: { background: p.accent, width: '30%', height: '10px', borderRadius: '99px', marginTop: 'auto' } }))),
        h('div.name', { html: `${esc(p.name)}${T.preset === k ? icon('check') : ''}` }));
      card.querySelector('.name svg')?.setAttribute('style', 'width:14px;height:14px;color:var(--accent)');
      target.append(card);
    }
    body.append(group('Gotowe motywy', grid));
    if (pluginGrid.children.length) body.append(group('Motywy z pluginów', pluginGrid));
    else body.append(h('div.banner', { html: `${icon('palette')}<div class="grow"><b>Chcesz więcej motywów?</b><br><span class="muted">Plugin EvenMoreColors dodaje 24 motywy i generator kolorów.</span></div>` }, btn('Sklep z pluginami', { cls: 'sm', onClick: () => navigate('settings', 'plugins') })));

    // akcent
    const sw = h('div.accent-swatches');
    const vars = themeVars();
    for (const c of ACCENTS) {
      sw.append(h('button' + (vars.accent.toLowerCase() === c ? '.on' : ''), { style: { background: c }, title: c, on: { click: () => { T.custom = { ...T.custom, accent: c, 'accent-text': lum(c) > 0.45 ? '#111111' : '#ffffff' }; changed()(); refresh(); } } }));
    }
    body.append(group('Kolor akcentu',
      h('div.setting', null, sw),
      toggleRow('Dynamiczny akcent z okładki', 'Kolor akcentu dopasowuje się do okładki aktualnego utworu.', T, 'dynamicAccent', () => updateDynamicAccent(P.current?.thumb?.replace('/mqdefault.jpg', '/hqdefault.jpg'))),
      toggleRow('Tło z okładki (ambient)', 'Delikatna, rozmyta poświata z okładki w tle aplikacji.', T, 'ambient', () => setAmbient(P.current?.thumb?.replace('/mqdefault.jpg', '/hqdefault.jpg'))),
    ));

    // własne kolory
    const cg = h('div.color-grid');
    for (const [k, label] of VAR_KEYS) {
      const inp = h('input', { type: 'color' });
      inp.value = toHex(vars[k]);
      inp.addEventListener('input', () => {
        T.custom = { ...T.custom, [k]: inp.value };
        applyTheme();
      });
      inp.addEventListener('change', () => saveSettings());
      cg.append(h('label.color-row', null, h('span', { text: label }), inp));
    }
    body.append(group('Własne kolory', cg, h('div.setting', null,
      h('div.lbl', { html: '<b>Udostępnij motyw</b><small>Skopiuj swój motyw jako tekst lub wklej motyw od kogoś innego.</small>' }),
      h('div.ctl', null,
        btn('Kopiuj', { icon: 'copy', cls: 'sm', onClick: () => { navigator.clipboard.writeText(JSON.stringify({ justmusicTheme: 1, vars: themeVars(), style: S.settings.style })); toast('Skopiowano motyw do schowka'); } }),
        btn('Wklej', { icon: 'upload', cls: 'sm', onClick: async () => {
          try {
            const j = JSON.parse(await navigator.clipboard.readText());
            if (!j.justmusicTheme) throw new Error();
            T.custom = j.vars; if (j.style) Object.assign(S.settings.style, j.style);
            changed()(); refresh(); toast('Zastosowano motyw');
          } catch { toast('Schowek nie zawiera motywu JustMusic', { error: true }); }
        } }),
        btn('Resetuj kolory', { cls: 'sm ghost', onClick: () => { T.custom = {}; changed()(); refresh(); } })))));
  },

  // ---------------- styl ----------------
  style(body) {
    const st = S.settings.style;
    body.append(h('h2', { text: 'Styl' }), h('p', { text: 'Kształty, typografia, gęstość i efekty.' }));
    body.append(group('Kształt i typografia',
      rangeRow('Zaokrąglenie rogów', null, st, 'radius', 0, 24, 1, ' px', applyStyle),
      selectRow('Czcionka', 'Używa czcionek zainstalowanych w systemie.', st, 'font', Object.entries(FONTS).map(([k, v]) => [k, v[0]]), applyStyle),
      rangeRow('Rozmiar tekstu', null, st, 'fontScale', 85, 130, 5, ' %', applyStyle),
      selectRow('Okładki', null, st, 'cover', [['rounded', 'Zaokrąglone'], ['square', 'Kwadratowe'], ['round', 'Okrągłe (winyl)']], applyStyle),
    ));
    body.append(group('Gęstość i panele',
      selectRow('Gęstość list', null, st, 'density', [['compact', 'Kompaktowa'], ['comfortable', 'Wygodna'], ['spacious', 'Przestronna']], applyStyle),
      selectRow('Wygląd paneli', 'Pływające karty z odstępami lub płaskie panele od krawędzi do krawędzi.', st, 'panels', [['cards', 'Karty'], ['flat', 'Płaskie']], applyStyle),
      toggleRow('Efekt szkła (blur)', 'Półprzezroczyste panele z rozmyciem – najlepiej z włączonym tłem z okładki.', st, 'glass', applyStyle),
      toggleRow('Animacje', 'Wyłącz, aby zyskać maksymalną wydajność na słabszym sprzęcie.', st, 'animations', applyStyle),
    ));
    const css = h('textarea.input', { rows: 8, placeholder: '/* Twój CSS, np.:\n.row .t-title { letter-spacing: .02em }\n#player { border-top: 2px solid var(--accent) } */', spellcheck: false });
    css.value = st.customCSS || '';
    css.addEventListener('input', () => { st.customCSS = css.value; applyStyle(); });
    css.addEventListener('change', () => saveSettings());
    body.append(group('Własny CSS', h('div.setting.col', null, h('div.lbl', { html: '<small>Pełna kontrola nad wyglądem. Dostępne zmienne: --bg, --surface, --accent, --text, --radius, --row-h i inne.</small>' }), css)));
  },

  // ---------------- układ ----------------
  layout(body) {
    const L = S.settings.layout;
    body.append(h('h2', { text: 'Układ paneli' }), h('p', { text: 'Ułóż interfejs po swojemu. Szerokość paneli zmienisz też przeciągając ich krawędź (dwuklik = reset).' }));
    const prev = h('div.layout-preview');
    const drawPrev = () => {
      const side = L.sidebarHidden ? [] : [['s', 'Menu']];
      const queue = L.queue ? [['q', 'Kolejka']] : [];
      const cols = L.sidebar === 'right' ? [...queue, ['m', 'Treść'], ...side] : [...side, ['m', 'Treść'], ...queue];
      prev.style.gridTemplateColumns = cols.map((c) => (c[0] === 'm' ? '1fr' : L.sidebarCompact && c[0] === 's' ? '14px' : '42px')).join(' ');
      const rows = L.player === 'top' ? ['p', 'c'] : ['c', 'p'];
      prev.style.gridTemplateRows = rows.map((r) => (r === 'p' ? '18px' : '1fr')).join(' ');
      prev.style.gridTemplateAreas = rows.map((r) => `"${cols.map((c) => (r === 'p' ? 'p' : c[0])).join(' ')}"`).join(' ');
      prev.replaceChildren(...cols.map((c) => h('i' + (c[0] === 'm' ? '.m' : ''), { style: { gridArea: c[0] }, text: L.sidebarCompact && c[0] === 's' ? '' : c[1] })), h('i.p', { style: { gridArea: 'p' }, text: 'Odtwarzacz' }));
    };
    drawPrev();
    const after = () => { applyLayout(); drawPrev(); emit('queuePanel'); };
    body.append(group('Rozmieszczenie',
      h('div.setting', null, h('div.lbl', { html: '<b>Podgląd</b><small>Zmiany są stosowane od razu.</small>' }), prev),
      selectRow('Panel menu', null, L, 'sidebar', [['left', 'Po lewej'], ['right', 'Po prawej']], after),
      selectRow('Odtwarzacz', null, L, 'player', [['bottom', 'Na dole'], ['top', 'Na górze']], after),
      selectRow('Styl odtwarzacza', 'Minimalny ukrywa czas i zamienia pasek postępu w cienką linię.', L, 'playerStyle', [['full', 'Pełny'], ['minimal', 'Minimalny']], after),
      toggleRow('Panel kolejki', 'Po przeciwnej stronie niż menu. Skrót: Q', L, 'queue', after),
      toggleRow('Kompaktowe menu', 'Tylko ikony.', L, 'sidebarCompact', after),
      toggleRow('Ukryj menu', null, L, 'sidebarHidden', after),
      row('Szerokość paneli', 'Menu / kolejka', h('span.muted', { text: `${L.sidebarWidth}px / ${L.queueWidth}px` }), btn('Resetuj', { cls: 'sm', onClick: () => { L.sidebarWidth = 248; L.queueWidth = 320; changed(after)(); refresh(); } })),
    ));
    body.append(group('Sekcje menu',
      toggleRow('Playlisty', null, L.sidebarSections, 'playlists'),
      toggleRow('Zakładki', null, L.sidebarSections, 'bookmarks'),
      toggleRow('Widoki pluginów', null, L.sidebarSections, 'plugins'),
    ));
    body.append(group('Sekcje strony startowej',
      toggleRow('Szybki dostęp', null, L.homeSections, 'quick'),
      toggleRow('Ostatnio odtwarzane', null, L.homeSections, 'recent'),
      toggleRow('Playlisty', null, L.homeSections, 'playlists'),
      toggleRow('Zakładki', null, L.homeSections, 'bookmarks'),
    ));
    const startWb = L.windowButtons;
    const restartBtn = btn('Uruchom ponownie', { cls: 'sm', onClick: () => { flush(); setTimeout(() => window.jm.relaunch(), 300); } });
    restartBtn.style.display = 'none';
    body.append(group('Okno',
      row('Przyciski okna', 'Zamknij / minimalizuj / maksymalizuj – w stylu aplikacji albo systemowe.',
        select([['auto', 'Automatycznie'], ['right', 'Aplikacji – po prawej (ikony)'], ['left', 'Aplikacji – po lewej (kropki)'], ['system', 'Systemowe (natywna ramka)']], L.windowButtons, (v) => {
          const wasSystem = startWb === 'system';
          L.windowButtons = v;
          saveSettings();
          // przejście z/do ramki systemowej wymaga restartu; zmiana stylu – tylko przeładowania interfejsu
          if (v === 'system' || wasSystem) restartBtn.style.display = '';
          else { flush(); setTimeout(() => location.reload(), 200); }
        }),
        restartBtn),
    ));
  },

  // ---------------- odtwarzanie ----------------
  playback(body) {
    const pb = S.settings.playback;
    body.append(h('h2', { text: 'Odtwarzanie' }), h('p', { text: 'Dźwięk, korektor i zachowanie odtwarzacza.' }));
    body.append(group('Korektor (EQ)', h('div.setting', null, eqPanel())));
    body.append(group('Zachowanie',
      rangeRow('Płynne wyciszanie (pauza/wznowienie)', null, pb, 'fadeMs', 0, 1000, 50, ' ms'),
      rangeRow('Krok przewijania (Shift+←/→)', null, pb, 'seekStep', 5, 30, 5, ' s'),
      toggleRow('Wznawiaj ostatnią sesję', 'Po uruchomieniu przywraca kolejkę i pozycję utworu.', pb, 'resume'),
      toggleRow('Wstępne ładowanie następnego utworu', 'Szybsze przejścia między utworami z YouTube.', pb, 'prefetch'),
    ));
    body.append(group('Dane',
      row('Historia odtwarzania', `${S.data.history.length} wpisów`, btn('Wyczyść', { cls: 'sm', onClick: () => { S.data.history = []; saveData(); toast('Wyczyszczono historię'); refresh(); } })),
      row('Historia wyszukiwania', `${S.data.searches.length} wpisów`, btn('Wyczyść', { cls: 'sm', onClick: () => { S.data.searches = []; saveData(); toast('Wyczyszczono'); refresh(); } })),
    ));
  },

  // ---------------- pobieranie ----------------
  downloads(body) {
    const cfg = S.settings.downloads;
    body.append(h('h2', { text: 'Pobieranie' }), h('p', { text: 'Pobieraj muzykę na dysk i słuchaj offline – bez limitów.' }));
    const engine = h('div');
    body.append(group('Silnik (yt-dlp i ffmpeg)', engine));
    const drawEngine = async (fresh = false) => {
      engine.replaceChildren(h('div.spinner-row', null, spinner(), 'Sprawdzanie…'));
      try { if (fresh || !S.ytStatus) S.ytStatus = await window.jm.yt.status(); } catch {}
      const st = S.ytStatus || {};
      const progress = h('div.progress', { style: { width: '160px', display: 'none' } }, h('i', { style: { width: '0%' } }));
      const installBtn = btn(st.ready ? (st.managed ? 'Aktualizuj' : 'Zainstaluj wersję zarządzaną') : 'Zainstaluj yt-dlp', {
        primary: !st.ready, icon: 'download', cls: 'sm',
        onClick: async () => {
          installBtn.disabled = true;
          progress.style.display = '';
          const off = window.jm.yt.onInstallProgress((p) => (progress.firstChild.style.width = Math.round(p * 100) + '%'));
          try {
            S.ytStatus = await window.jm.yt.install();
            toast('yt-dlp gotowy ✓');
            emit('yt:status');
          } catch (e) {
            toast('Instalacja nie powiodła się: ' + e.message, { error: true });
          } finally { off(); drawEngine(); }
        },
      });
      engine.replaceChildren(
        row('yt-dlp', st.ready ? `<span class="status-dot ok"></span>Wersja ${esc(st.version)} · <span class="code">${esc(st.path)}</span>` : '<span class="status-dot"></span>Nie znaleziono – wymagany do YouTube i Spotify. Pobierany z oficjalnego GitHuba.', progress, installBtn, iconBtn('refresh', 'Sprawdź ponownie', () => drawEngine(true), 'sm')),
        row('ffmpeg', st.ffmpeg
          ? `<span class="status-dot ok"></span>Znaleziono · <span class="code">${esc(st.ffmpeg)}</span>`
          : `<span class="status-dot"></span>Opcjonalny – potrzebny do MP3/OPUS, okładek i tagów. Instalacja: ${S.platform === 'win32' ? '<span class="code">winget install ffmpeg</span>' : S.platform === 'darwin' ? '<span class="code">brew install ffmpeg</span>' : '<span class="code">sudo apt install ffmpeg</span> / <span class="code">sudo pacman -S ffmpeg</span>'}`),
      );
    };
    drawEngine();

    const dirLabel = h('span.code', { text: cfg.dir });
    body.append(group('Pliki',
      row('Folder docelowy', null, dirLabel, btn('Zmień', { cls: 'sm', icon: 'folder', onClick: async () => {
        const d = await window.jm.dialog.folder('Folder na pobraną muzykę');
        if (d) { cfg.dir = d; dirLabel.textContent = d; saveSettings(); }
      } })),
      selectRow('Format', 'M4A (AAC) nie wymaga konwersji – najszybszy i najwyższa jakość źródła. MP3/OPUS wymagają ffmpeg.', cfg, 'format', [['m4a', 'M4A (AAC) – zalecany'], ['mp3', 'MP3 (najlepsza jakość VBR)'], ['opus', 'OPUS'], ['best', 'Oryginał (bez konwersji)']]),
      toggleRow('Zapisuj czyste tagi', 'Tytuł, wykonawca i album z JustMusic/Spotify zamiast tytułu filmu (wymaga ffmpeg).', cfg, 'tag'),
      selectRow('Równoległe pobieranie', null, cfg, 'concurrent', [[1, '1'], [2, '2'], [3, '3'], [4, '4'], [6, '6']]),
    ));

    const cacheRow = h('div');
    body.append(group('Bufor odtwarzania', cacheRow));
    const drawCache = async () => {
      const info = await window.jm.cache.info().catch(() => ({ size: 0, count: 0 }));
      cacheRow.replaceChildren(row('Pliki tymczasowe', `${info.count} plików · ${fmtBytes(info.size)} – używane, gdy bezpośredni strumień zawiedzie.`,
        btn('Wyczyść', { cls: 'sm', onClick: async () => { await window.jm.cache.clear(); toast('Wyczyszczono bufor'); drawCache(); } })));
    };
    drawCache();
  },

  // ---------------- youtube ----------------
  youtube(body) {
    const y = S.settings.youtube;
    const push = () => window.jm.yt.config(y);
    body.append(h('h2', { text: 'YouTube' }), h('p', { text: 'Wyszukiwanie i odtwarzanie przez yt-dlp.' }));
    body.append(group('Wyszukiwanie',
      selectRow('Źródło wyszukiwania', 'YouTube Music zwraca czystsze wyniki muzyczne (eksperymentalne).', y, 'searchMode', [['youtube', 'YouTube'], ['music', 'YouTube Music']], push),
      selectRow('Liczba wyników', null, y, 'results', [[15, '15'], [25, '25'], [40, '40'], [60, '60']], push),
    ));
    body.append(group('Zaawansowane',
      selectRow('Cookies z przeglądarki', 'Pomaga, gdy YouTube prosi o potwierdzenie „nie jestem botem” lub dla treści z ograniczeniem wiekowym.', y, 'cookiesBrowser',
        [['', 'Wyłączone'], ['firefox', 'Firefox'], ['chrome', 'Chrome'], ['chromium', 'Chromium'], ['brave', 'Brave'], ['edge', 'Edge'], ['opera', 'Opera'], ['vivaldi', 'Vivaldi'], ['safari', 'Safari']], push),
      toggleRow('Wbudowany runtime JS', 'Udostępnia yt-dlp silnik JavaScript (Node/Electron) wymagany przez YouTube.', y, 'jsRuntime', push),
      textRow('Własna ścieżka yt-dlp', 'Puste = automatycznie', y, 'ytdlpPath', '/ścieżka/do/yt-dlp', 'text', push),
      textRow('Własna ścieżka ffmpeg', 'Puste = automatycznie', y, 'ffmpegPath', '/ścieżka/do/ffmpeg', 'text', push),
      textRow('Dodatkowe argumenty yt-dlp', 'Dla zaawansowanych, np. --proxy socks5://…', y, 'extraArgs', '--force-ipv4', 'text', push),
    ));
  },

  // ---------------- spotify ----------------
  spotify(body) {
    const sp = S.settings.spotify;
    body.append(h('h2', { text: 'Spotify' }), h('p', { text: 'Importuj playlisty, albumy i utwory ze Spotify – bez konta Premium.' }));
    body.append(h('div.banner', { html: `${icon('info')}<div class="grow">JustMusic czyta tylko <b>metadane</b> (tytuły, wykonawców) i dopasowuje utwory do nagrań na YouTube. Klucze API są <b>opcjonalne</b> – bez nich import działa dla publicznych playlist (do ~50 utworów).</div>` }));
    body.append(group('Klucze API (opcjonalne, darmowe)',
      textRow('Client ID', null, sp, 'clientId', 'np. 1a2b3c…'),
      textRow('Client Secret', null, sp, 'clientSecret', '••••••••', 'password'),
      h('div.setting', null, h('div.lbl', { html: '<small>Jak zdobyć: zaloguj się na <b>developer.spotify.com/dashboard</b> → „Create app” → dowolna nazwa, Redirect URI: <span class="code">http://127.0.0.1/</span> → skopiuj Client ID i Secret. To nic nie kosztuje.</small>' }),
        btn('Otwórz panel', { cls: 'sm', icon: 'external', onClick: () => window.jm.shell.external('https://developer.spotify.com/dashboard') })),
    ));
    body.append(group('Dopasowania',
      row('Zapamiętane dopasowania Spotify → YouTube', `${Object.keys(S.data.spMap).length} utworów`, btn('Wyczyść', { cls: 'sm', onClick: () => { S.data.spMap = {}; saveData(); toast('Wyczyszczono'); refresh(); } })),
    ));
  },

  // ---------------- biblioteka ----------------
  library(body) {
    const lib = S.settings.library;
    body.append(h('h2', { text: 'Biblioteka' }), h('p', { text: 'Foldery z Twoją muzyką. Obsługiwane: MP3, M4A, FLAC, OGG, OPUS, WAV, AAC, WEBM.' }));
    const rows = lib.folders.map((f) => row(f, null, btn('Otwórz', { cls: 'sm ghost', onClick: () => window.jm.shell.open(f) }), btn('Usuń', { cls: 'sm danger', onClick: () => { removeFolder(f); refresh(); } })));
    body.append(group('Foldery',
      ...(rows.length ? rows : [h('div.setting.muted', { text: 'Brak folderów.' })]),
      h('div.setting', null, btn('Dodaj folder', { icon: 'folderPlus', primary: true, onClick: async () => { await addFolder(); refresh(); } }), btn('Skanuj teraz', { icon: 'refresh', onClick: () => rescan(true) })),
    ));
    body.append(group('Opcje', toggleRow('Skanuj przy starcie', 'Skanowanie przyrostowe – tylko zmienione pliki.', lib, 'scanOnStart')));
  },

  // ---------------- pluginy ----------------
  plugins(body) {
    body.append(h('h2', { text: 'Pluginy' }), h('p', { text: 'JustMusic startuje bez pluginów – pobierz tylko te, których potrzebujesz. Zainstalowane pluginy możesz w każdej chwili wyłączyć lub usunąć.' }));
    const installedBox = h('div');
    const storeBox = h('div', null, h('div.spinner-row', null, spinner(), 'Wczytywanie sklepu…'));
    body.append(h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', margin: '4px 0 12px' } },
      h('h3', { text: 'Zainstalowane', style: { margin: '0', flex: '1', fontSize: '17px' } }),
      btn('Folder pluginów', { icon: 'folder', cls: 'sm ghost', onClick: () => window.jm.plugins.openFolder() }),
      btn('Przeładuj', { icon: 'refresh', cls: 'sm ghost', onClick: async () => { await reloadPlugins(); toast('Przeładowano pluginy'); refresh(); } })),
      installedBox,
      h('h3', { text: 'Sklep z pluginami', style: { margin: '28px 0 12px', fontSize: '17px' } }),
      storeBox);

    // --- zainstalowane ---
    const g = h('div.group');
    for (const p of plugins.list) {
      const enabled = !!S.settings.plugins.enabled[p.id];
      const err = plugins.errors.get(p.id);
      const card = h('div.plugin-card');
      card.append(h('div.pic', { html: icon(p.icon || 'puzzle') }),
        h('div.info', { html: `<b>${esc(p.name)}</b><span class="tag">v${esc(p.version)}</span><small>${esc(p.short || p.description)}</small>${err ? `<small style="color:var(--danger)">Błąd: ${esc(err)}</small>` : ''}` }),
        plugins.settingsRenderers.get(p.id) && enabled
          ? iconBtn('settings', 'Ustawienia pluginu', () => { openPluginSettings.has(p.id) ? openPluginSettings.delete(p.id) : openPluginSettings.add(p.id); refresh(); }, 'sm gear' + (openPluginSettings.has(p.id) ? ' on' : ''))
          : h('span'),
        iconBtn('trash', 'Odinstaluj', async () => {
          if (!(await confirmDialog({ title: `Odinstalować „${p.name}”?`, text: 'Ustawienia pluginu zostaną usunięte.', ok: 'Odinstaluj', danger: true }))) return;
          await uninstallPlugin(p.id); toast(`Odinstalowano ${p.name}`); refresh();
        }, 'sm'),
        switchEl(enabled, async (v) => { await setPluginEnabled(p.id, v); refresh(); }));
      g.append(card);
      const render = plugins.settingsRenderers.get(p.id);
      if (enabled && render && openPluginSettings.has(p.id)) {
        const box = h('div.plugin-settings');
        try { render(box); } catch (e) { box.textContent = e.message; }
        g.append(box);
      }
    }
    if (!plugins.list.length) g.append(h('div.setting', null, h('div.lbl', { html: '<b>Brak zainstalowanych pluginów</b><small>Wybierz coś ze sklepu poniżej – instalacja trwa sekundę.</small>' })));
    installedBox.append(g);

    // --- sklep ---
    storeCatalog().then(({ items, error }) => {
      storeBox.replaceChildren();
      if (error) storeBox.append(h('div.banner.warn', { html: `${icon('alert')}<div class="grow">Zdalny katalog niedostępny: ${esc(error)}</div>` }));
      const grid = h('div.store-grid');
      const installed = new Map(plugins.list.map((p) => [p.id, p]));
      for (const p of items.sort((a, b) => a.name.localeCompare(b.name, 'pl'))) {
        const inst = installed.get(p.id);
        const update = inst && String(p.version).localeCompare(String(inst.version), undefined, { numeric: true }) > 0;
        const card = h('div.store-card' + (inst ? '.installed' : ''));
        card.append(...[
          h('div.top', null, h('div.pic', { html: icon(p.icon || 'puzzle') }),
            h('div', { style: { minWidth: '0' } }, h('div.nm', { text: p.name }), h('div.meta', { text: `v${p.version}${p.author ? ' · ' + p.author : ''}` }))),
          h('div.short', { text: p.short || p.description }),
          p.tags?.length ? h('div.tags', null, ...p.tags.map((t) => h('span', { text: t }))) : null,
          p.description && p.description !== p.short ? h('details', null, h('summary', { text: 'Więcej informacji' }), h('p', { text: p.description })) : null,
        ].filter(Boolean));
        const actions = h('div.row-actions');
        const doInstall = async (b) => {
          b.disabled = true;
          b.innerHTML = '<div class="loading-spin" style="width:14px;height:14px"></div><span>Pobieranie…</span>';
          try {
            await installPlugin(p.id);
            if (!update) { openPluginSettings.clear(); openPluginSettings.add(p.id); }
            toast(`${update ? 'Zaktualizowano' : 'Zainstalowano'}: ${p.name}`);
            refresh();
          } catch (e) {
            toast('Instalacja nie powiodła się: ' + e.message, { error: true });
            b.disabled = false;
          }
        };
        if (!inst) {
          const b = btn('Pobierz', { icon: 'download', primary: true, cls: 'sm', onClick: () => doInstall(b) });
          actions.append(b);
        } else if (update) {
          const b = btn(`Aktualizuj do v${p.version}`, { icon: 'refresh', primary: true, cls: 'sm', onClick: () => doInstall(b) });
          actions.append(b);
        } else {
          actions.append(h('span.muted', { html: `${icon('check')} Zainstalowano`, style: { display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '13px', color: 'var(--accent)' } }));
        }
        actions.append(h('div.grow'));
        card.append(actions);
        grid.append(card);
      }
      if (!items.length) storeBox.append(h('div.empty', { html: `${icon('store')}<p>Sklep jest pusty.</p>` }));
      storeBox.append(grid);
      const urlRow = textRow('Zdalny katalog pluginów (opcjonalnie)', 'Adres pliku JSON z listą pluginów (HTTPS). Puste = tylko katalog dołączony do aplikacji.', S.settings.plugins, 'catalogUrl', 'https://…/catalog.json');
      storeBox.append(group('Zaawansowane', urlRow, h('div.setting', null, h('div.lbl', { html: '<b>Własne pluginy</b><small>Wrzuć folder z <span class="code">manifest.json</span> do folderu pluginów i kliknij „Przeładuj”. Dokumentacja API: <span class="code">store/README.md</span>.</small>' }))));
    }).catch((e) => storeBox.replaceChildren(h('div.banner.warn', { html: `${icon('alert')}<div class="grow">${esc(e.message)}</div>` })));
  },

  // ---------------- system ----------------
  system(body) {
    const sys = S.settings.system;
    body.append(h('h2', { text: 'System' }), h('p', { text: 'Pasek zadań, zasobnik systemowy i uruchamianie razem z systemem.' }));
    const osName = { win32: 'Windows', darwin: 'macOS', linux: 'Linux' }[S.platform] || S.platform;

    // skrót / przypinanie
    const pinBox = h('div');
    body.append(group('Pasek zadań i menu aplikacji', pinBox));
    const drawPin = async () => {
      const st = await window.jm.system.shortcutStatus().catch(() => ({ supported: false }));
      const howTo = S.platform === 'win32'
        ? 'Po dodaniu: Start → JustMusic → prawy przycisk → „Przypnij do paska zadań”. Możesz też kliknąć prawym ikonę uruchomionej aplikacji na pasku zadań → „Przypnij”.'
        : S.platform === 'darwin'
          ? 'Kliknij prawym ikonę JustMusic w Docku → Opcje → „Zachowaj w Docku”.'
          : 'Po dodaniu JustMusic pojawi się w menu aplikacji. Kliknij prawym ikonę uruchomionej aplikacji na pasku zadań (lub w menu) → „Przypnij do paska zadań / Dodaj do ulubionych”.';
      pinBox.replaceChildren(
        st.supported
          ? row(st.installed ? 'JustMusic jest w menu aplikacji' : 'Dodaj JustMusic do menu aplikacji', howTo,
            st.installed
              ? btn('Usuń skrót', { cls: 'sm ghost', onClick: async () => { await window.jm.system.removeShortcut(); toast('Usunięto skrót'); drawPin(); } })
              : null,
            btn(st.installed ? 'Odśwież skrót' : 'Dodaj skrót', { icon: 'pin', primary: !st.installed, cls: 'sm', onClick: async () => {
              try { await window.jm.system.installShortcut({ desktop: false }); toast('Dodano JustMusic do menu aplikacji'); drawPin(); } catch (e) { toast(e.message, { error: true }); }
            } }),
            btn('+ na pulpicie', { cls: 'sm ghost', onClick: async () => { try { await window.jm.system.installShortcut({ desktop: true }); toast('Dodano skrót na pulpicie'); } catch (e) { toast(e.message, { error: true }); } } }))
          : row('Przypinanie do Docka', howTo),
        toggleRow('Postęp utworu na pasku zadań', S.platform === 'win32' ? 'Pasek postępu na ikonie aplikacji + przyciski ⏮ ⏯ ⏭ w podglądzie okna.' : 'Pasek postępu na ikonie aplikacji (jeśli środowisko to obsługuje).', sys, 'taskbarProgress'),
      );
    };
    drawPin();

    body.append(group('Zasobnik systemowy',
      toggleRow('Ikona w zasobniku', 'Szybkie sterowanie odtwarzaniem z ikony obok zegara.', sys, 'tray', () => { if (!sys.tray) sys.closeToTray = false; refresh(); }),
      sys.tray ? toggleRow('Zamykanie do zasobnika', 'Krzyżyk chowa okno, a muzyka gra dalej. Zakończ aplikację z menu ikony w zasobniku.', sys, 'closeToTray') : null,
    ));

    // autostart
    const autoBox = h('div');
    body.append(group('Uruchamianie', autoBox));
    const drawAuto = async () => {
      const st = await window.jm.system.getAutostart().catch(() => ({ enabled: false, hidden: false }));
      const set = async (enabled, hidden) => {
        try {
          await window.jm.system.setAutostart(enabled, hidden);
          if (hidden && !sys.tray) { sys.tray = true; saveSettings(); emit('settings'); }
          toast(enabled ? 'JustMusic uruchomi się razem z systemem' : 'Wyłączono autostart');
        } catch (e) { toast(e.message, { error: true }); }
        drawAuto();
      };
      autoBox.replaceChildren(...[
        row('Uruchamiaj przy starcie systemu', `JustMusic włączy się automatycznie po zalogowaniu do ${osName}.`, switchEl(st.enabled, (v) => set(v, st.hidden))),
        st.enabled ? row('Uruchamiaj zminimalizowany', 'Startuje schowany w zasobniku, bez otwierania okna.', switchEl(st.hidden, (v) => set(true, v))) : null,
        !S.packaged ? h('div.setting', null, h('div.lbl', { html: '<small>Uruchomiono w trybie deweloperskim – autostart i skrót wskazują na ten folder projektu. Po zbudowaniu instalatora ustaw je ponownie z zainstalowanej wersji.</small>' })) : null,
      ].filter(Boolean));
    };
    drawAuto();
  },

  // ---------------- skróty ----------------
  shortcuts(body) {
    const mod = S.platform === 'darwin' ? '⌘' : 'Ctrl';
    const list = [
      ['Odtwórz / pauza', 'Spacja'], ['Następny utwór', `${mod} + →`], ['Poprzedni utwór', `${mod} + ←`],
      ['Przewiń do przodu / do tyłu', 'Shift + → / ←'], ['Głośność +/-', `${mod} + ↑ / ↓`], ['Wycisz', 'M'],
      ['Polub aktualny utwór', 'L'], ['Losowo', 'S'], ['Powtarzanie', 'R'], ['Pokaż/ukryj kolejkę', 'Q'],
      ['Zapisz moment (zakładka)', `${mod} + B`], ['Zakładka z notatką', `${mod} + Shift + B`], ['Szukaj', `${mod} + K  lub  /`],
      ['Nowa playlista', `${mod} + N`], ['Ustawienia', `${mod} + ,`], ['Wstecz / dalej', 'Alt + ← / →'],
      ['Zaznacz wszystko na liście', `${mod} + A`], ['Odtwórz zaznaczone', 'Enter'], ['Usuń z playlisty', 'Delete'],
      ['Klawisze multimedialne', 'obsługiwane systemowo'],
    ];
    const g = h('div.kbd-list');
    for (const [a, k] of list) g.append(h('span', { text: a }), h('span', { html: k.split('  lub  ').map((x) => `<kbd class="k">${esc(x)}</kbd>`).join(' lub ') }));
    body.append(h('h2', { text: 'Skróty klawiszowe' }), h('p', { text: 'Steruj muzyką bez myszy.' }), group(null, g));
  },

  // ---------------- o aplikacji ----------------
  about(body) {
    body.append(h('div', { style: { display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '20px' } },
      h('div.brand', { html: `<div class="logo" style="width:56px;height:56px;border-radius:16px">${icon('logo')}</div>` }),
      h('div', { html: `<h2 style="margin:0">JustMusic</h2><span class="muted">Wersja ${esc(S.version)} · ${esc({ win32: 'Windows', darwin: 'macOS', linux: 'Linux' }[S.platform] || S.platform)}</span>` })));
    body.append(group('Aktualizacje', updatesPanel(row, toggleRow)));
    body.append(group('Twoje dane',
      row('Folder danych aplikacji', `<span class="code">${esc(S.paths.userData)}</span>`, btn('Otwórz', { cls: 'sm', onClick: () => window.jm.shell.open(S.paths.userData) })),
      row('Kopia zapasowa', 'Zapisz playlisty, polubione i zakładki do pliku JSON (schowek).', btn('Kopiuj do schowka', { cls: 'sm', onClick: () => {
        navigator.clipboard.writeText(JSON.stringify({ justmusicBackup: 1, data: { ...S.data, session: null } }));
        toast('Skopiowano kopię zapasową');
      } }), btn('Przywróć ze schowka', { cls: 'sm ghost', onClick: async () => {
        try {
          const j = JSON.parse(await navigator.clipboard.readText());
          if (!j.justmusicBackup) throw new Error();
          if (!(await confirmDialog({ title: 'Przywrócić kopię?', text: 'Obecne playlisty, polubione i zakładki zostaną zastąpione.', ok: 'Przywróć', danger: true }))) return;
          Object.assign(S.data, j.data);
          saveData();
          ['playlists', 'liked', 'bookmarks', 'library'].forEach((e) => emit(e));
          toast('Przywrócono dane');
        } catch { toast('Schowek nie zawiera kopii JustMusic', { error: true }); }
      } })),
      row('Resetuj wygląd', 'Przywraca domyślny motyw, styl i układ.', btn('Resetuj', { cls: 'sm danger', onClick: async () => {
        if (!(await confirmDialog({ title: 'Zresetować wygląd?', ok: 'Resetuj', danger: true }))) return;
        S.settings.theme = structuredClone(DEFAULT_SETTINGS.theme);
        S.settings.style = structuredClone(DEFAULT_SETTINGS.style);
        S.settings.layout = structuredClone(DEFAULT_SETTINGS.layout);
        changed(applyAll)();
        refresh();
      } })),
    ));
    body.append(h('p.muted', { style: { fontSize: '12px', marginTop: '16px' }, html: 'Zbudowane na Electron, yt-dlp i music-metadata. Korzystaj zgodnie z prawem autorskim i regulaminami serwisów – pobieraj tylko to, do czego masz prawo.' }));
  },
};

function lum(hex) {
  const [r, g, b] = hex.replace('#', '').match(/.{2}/g).map((x) => parseInt(x, 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function toHex(c) {
  if (/^#[0-9a-f]{6}$/i.test(c)) return c;
  if (/^#[0-9a-f]{3}$/i.test(c)) return '#' + c.slice(1).split('').map((x) => x + x).join('');
  return '#000000';
}
