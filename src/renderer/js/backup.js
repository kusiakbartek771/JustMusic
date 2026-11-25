// Eksport i import ustawień JustMusic (i opcjonalnie biblioteki) do pliku JSON –
// np. żeby przenieść wszystko na inny komputer albo zrobić kopię przed eksperymentami.
import { S, DEFAULT_SETTINGS, saveData, flush } from './state.js';
import { h, btn, modal, toast } from './ui.js';
import { icon } from './icons.js';
import * as player from './player.js';

const FORMAT = 2;
// dane, które nie mają sensu na innym komputerze albo odtworzą się same
const DATA_SKIP = ['session', 'downloads'];

const PARTS = [
  ['settings', 'Ustawienia', 'Wygląd i motyw, układ, odtwarzanie, korektor, skróty klawiszowe, język, pluginy i ich ustawienia'],
  ['library', 'Biblioteka', 'Playlisty, polubione, zakładki, historia słuchania i wyszukiwań'],
];

function checks(available, initial) {
  const state = { ...initial };
  const box = h('div.bk-parts');
  for (const [k, label, hint] of PARTS) {
    if (!available[k]) continue;
    const cb = h('input', { type: 'checkbox', checked: !!state[k], on: { change: () => { state[k] = cb.checked; } } });
    box.append(h('label.bk-part', null, cb, h('div', null, h('b', { text: label }), h('small.muted', { text: hint }))));
  }
  return { box, state };
}

export function exportBackup() {
  const { box, state } = checks({ settings: true, library: true }, { settings: true, library: true });
  const m = modal([
    h('h3', { html: `${icon('download')} Eksportuj ustawienia` }),
    h('p', { text: 'Zapisz ustawienia JustMusic do pliku – przeniesiesz je na inny komputer albo przywrócisz później.' }),
    box,
    h('p.muted', { style: { fontSize: '12px' }, text: 'Plik może zawierać ustawienia pluginów, np. klucze i tokeny – nie udostępniaj go publicznie.' }),
    h('div.modal-actions', null,
      btn('Anuluj', { cls: 'ghost', onClick: () => m.close() }),
      btn('Zapisz plik', { primary: true, icon: 'download', onClick: async () => {
        if (!state.settings && !state.library) return toast('Wybierz, co zapisać', { error: true });
        flush();
        const out = makeBackup(state);
        const day = new Date().toISOString().slice(0, 10);
        try {
          const f = await window.jm.backup.export(JSON.stringify(out, null, 1), `JustMusic ${day}.json`);
          if (!f) return;
          m.close();
          toast('Zapisano ustawienia', { action: { label: 'Pokaż', onClick: () => window.jm.shell.show(f) } });
        } catch (e) { toast('Nie udało się zapisać: ' + e.message, { error: true }); }
      } }),
    ),
  ]);
}

function parse(text) {
  const j = JSON.parse(text);
  if (j?.justmusic === 'backup') return { settings: j.settings || null, data: j.data || null, version: j.version, at: j.exportedAt };
  if (j?.justmusicBackup) return { settings: null, data: j.data || null }; // dawna kopia ze schowka
  throw new Error('To nie jest plik z ustawieniami JustMusic');
}

/** łączy bibliotekę z pliku z obecną (nic nie znika) */
function mergeLibrary(d) {
  const cur = S.data;
  Object.assign(cur.tracks, d.tracks || {});
  const ids = new Set(cur.playlists.map((p) => p.id));
  for (const p of d.playlists || []) if (p?.id && !ids.has(p.id)) cur.playlists.push(p);
  cur.liked = [...new Set([...(d.liked || []), ...cur.liked])];
  const bm = new Set(cur.bookmarks.map((b) => b.id));
  for (const b of d.bookmarks || []) if (b?.id && !bm.has(b.id)) cur.bookmarks.push(b);
  cur.history = [...cur.history, ...(d.history || [])].sort((a, b) => (b.at || 0) - (a.at || 0)).slice(0, 1000);
  cur.searches = [...new Set([...(cur.searches || []), ...(d.searches || [])])].slice(0, 50);
  for (const k of ['spMap', 'lufs', 'trim']) cur[k] = { ...(d[k] || {}), ...(cur[k] || {}) };
}

/** Wczytuje kopię do stanu aplikacji (bez przeładowania interfejsu) */
export function applyBackup(b, { settings = true, library = true, mode = 'merge' } = {}) {
  if (settings && b.settings) {
    const keepDir = S.settings.downloads?.dir;
    for (const k of Object.keys(S.settings)) if (!(k in b.settings) && !(k in DEFAULT_SETTINGS)) delete S.settings[k];
    Object.assign(S.settings, structuredClone(b.settings));
    // folder pobierania jest z innego komputera – zostaje obecny
    if (S.settings.downloads && keepDir) S.settings.downloads.dir = keepDir;
    S.settings.onboarded = true;
  }
  if (library && b.data) {
    if (mode === 'replace') {
      for (const [k, v] of Object.entries(b.data)) if (!DATA_SKIP.includes(k)) S.data[k] = structuredClone(v);
    } else mergeLibrary(b.data);
    saveData();
  }
}

/** Zawartość pliku kopii → obiekt kopii (rzuca błąd, gdy to nie kopia JustMusic) */
export { parse as parseBackup };

/** Obecny stan jako obiekt kopii */
export function makeBackup({ settings = true, library = true } = {}) {
  const out = { justmusic: 'backup', format: FORMAT, version: S.version, exportedAt: new Date().toISOString() };
  if (settings) out.settings = structuredClone(S.settings);
  if (library) {
    out.data = {};
    for (const [k, v] of Object.entries(S.data)) if (!DATA_SKIP.includes(k)) out.data[k] = v;
  }
  return out;
}

function reloadUi() {
  const wasPlaying = player.P.playing;
  player.saveSession();
  S.data.session = { ...(S.data.session || {}), resumeAfterReload: { playing: wasPlaying } };
  flush();
  setTimeout(() => location.reload(), 200);
}

export async function importBackup() {
  let b;
  try {
    const text = await window.jm.backup.import();
    if (!text) return;
    b = parse(text);
  } catch (e) {
    return toast(e.message.startsWith('Unexpected') ? 'Plik jest uszkodzony' : e.message, { error: true });
  }
  const { box, state } = checks({ settings: !!b.settings, library: !!b.data }, { settings: true, library: true });
  let mode = 'merge';
  const modeSel = h('select.input', { on: { change: () => { mode = modeSel.value; } } },
    h('option', { value: 'merge', text: 'Połącz z obecną (nic nie znika)' }),
    h('option', { value: 'replace', text: 'Zastąp obecną' }));
  const info = [b.version ? `JustMusic ${b.version}` : null, b.at ? new Date(b.at).toLocaleString() : null].filter(Boolean).join(' · ');
  const m = modal([
    h('h3', { html: `${icon('upload')} Importuj ustawienia` }),
    h('p', { text: 'Wybierz, co wczytać z pliku.' + (info ? ` (${info})` : '') }),
    box,
    b.data ? h('div.setting', null, h('div.label', null, h('div.t', { text: 'Biblioteka' })), modeSel) : null,
    h('p.muted', { style: { fontSize: '12px' }, text: 'Po imporcie interfejs wczyta się ponownie, a muzyka zagra dalej.' }),
    h('div.modal-actions', null,
      btn('Anuluj', { cls: 'ghost', onClick: () => m.close() }),
      btn('Importuj', { primary: true, icon: 'upload', onClick: () => {
        if (!state.settings && !state.library) return toast('Wybierz, co wczytać', { error: true });
        applyBackup(b, { settings: state.settings, library: state.library, mode });
        m.close();
        toast('Zaimportowano – wczytuję ponownie…');
        reloadUi();
      } }),
    ),
  ]);
}
