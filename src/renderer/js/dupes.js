// Wykrywanie duplikatów: ten sam utwór dodany kilka razy – także jako różne wersje tego samego
// nagrania (np. „Official Video” i „Audio” z YouTube albo z Spotify i z pliku lokalnego).
// Wersje naprawdę inne (remix, live, acoustic…) zostają, bo te słowa nie są usuwane z tytułu.
import { S, tracksOf, saveData, emit } from './state.js';
import { h, esc, btn, modal, toast, cover, fmtTime } from './ui.js';
import { icon } from './icons.js';

// dopiski bez znaczenia dla tego, jaki to utwór
const NOISE = /\b(official(\s+(music|lyrics?|hd))?(\s+(video|audio|visuali[sz]er|clip))?|music\s+video|lyrics?(\s+video)?|audio|video|hd|hq|4k|full\s+hd|visuali[sz]er|teledysk|tekst|napisy|remaster(ed)?(\s+\d{4})?|\d{4}\s+remaster(ed)?|explicit|clean|radio\s+edit|mv|m\/v)\b/gi;

function normTitle(t) {
  let s = String(t.title || '').toLowerCase();
  const artist = String(t.artist || '').split(',')[0].trim().toLowerCase();
  // „Wykonawca - Tytuł” (typowe na YouTube)
  if (artist && s.startsWith(artist + ' - ')) s = s.slice(artist.length + 3);
  s = s.replace(/\s*[([]\s*(feat|ft)\.?[^)\]]*[)\]]/g, '').replace(/\s+(feat|ft)\.?\s.*$/, '');
  s = s.replace(/[([]([^)\]]*)[)\]]/g, (m, inner) => (inner.replace(NOISE, '').replace(/[\s\-–|,.]/g, '') ? ` ${inner} ` : ' '));
  s = s.replace(NOISE, ' ');
  return s.normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}
const normArtist = (t) => String(t.artist || '').split(/,|&|\bfeat\.?|\bft\.?/i)[0].toLowerCase().replace(/\s*-\s*topic$/, '').normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/** Zwraca grupy duplikatów: [[indeks, indeks, …], …] – pierwszy w grupie zostaje */
export function findDuplicates(tracks) {
  const groups = new Map();
  tracks.forEach((t, i) => {
    if (!t) return;
    const title = normTitle(t);
    const key = title ? `${normArtist(t)}|${title}` : `id|${t.id}`;
    let list = groups.get(key);
    if (!list) groups.set(key, (list = []));
    list.push(i);
  });
  const out = [];
  for (const idx of groups.values()) {
    if (idx.length < 2) continue;
    // ten sam tytuł, ale długość bardzo różna → inna wersja (np. extended mix)
    const keep = [idx[0]];
    const d0 = tracks[idx[0]].duration || 0;
    for (const i of idx.slice(1)) {
      const d = tracks[i].duration || 0;
      if (tracks[i].id === tracks[idx[0]].id || !d0 || !d || Math.abs(d - d0) <= 6) keep.push(i);
    }
    if (keep.length > 1) out.push(keep);
  }
  return out;
}

/**
 * Okno z listą duplikatów. ids – lista identyfikatorów (playlista / polubione),
 * apply(noweIds) – zapisuje wynik.
 */
export function dupesDialog(name, ids, apply) {
  const tracks = tracksOf(ids);
  // tracksOf pomija nieistniejące – trzymamy pozycje w oryginalnej liście
  const byPos = ids.map((id) => tracks.find((t) => t.id === id) || null);
  const groups = findDuplicates(byPos);
  if (!groups.length) return toast(`„${name}”: brak duplikatów 👍`);
  const remove = new Set(groups.flatMap((g) => g.slice(1)));
  const list = h('div.dupes');
  for (const g of groups) {
    const box = h('div.dupe-group');
    for (const i of g) {
      const t = byPos[i];
      const cb = h('input', { type: 'checkbox', checked: !remove.has(i), title: 'Zostaw', on: { change: () => { if (cb.checked) remove.delete(i); else remove.add(i); count(); } } });
      const src = t.source === 'local' ? 'plik' : t.source === 'spotify' ? 'Spotify' : 'YouTube';
      box.append(h('label.dupe-row', null, cb, cover(t.thumb, 'dupe-cover'),
        h('div.dupe-txt', { html: `<b>${esc(t.title)}</b><span class="muted">${esc(t.artist || '')} · ${src}${t.duration ? ' · ' + fmtTime(t.duration) : ''}</span>` })));
    }
    list.append(box);
  }
  const info = h('p.muted');
  const count = () => { info.textContent = `Zaznaczone zostają. Do usunięcia: ${remove.size}.`; };
  count();
  const m = modal([
    h('h3', { html: `${icon('copy')} Duplikaty – ${esc(name)}` }),
    h('p', { text: `Znaleziono ${groups.length} ${groups.length === 1 ? 'utwór powtórzony' : 'utworów powtórzonych'} (także różne wersje tego samego nagrania z YouTube, Spotify czy plików).` }),
    list, info,
    h('div.modal-actions', null,
      btn('Anuluj', { cls: 'ghost', onClick: () => m.close() }),
      btn('Usuń zaznaczone duplikaty', { primary: true, icon: 'trash', onClick: () => {
        const next = ids.filter((_, i) => !remove.has(i));
        apply(next);
        m.close();
        toast(`Usunięto ${remove.size} ${remove.size === 1 ? 'duplikat' : 'duplikatów'}`);
      } })),
  ], { wide: true });
}

export function playlistDupes(pl, after) {
  dupesDialog(pl.name, pl.trackIds, (ids) => { pl.trackIds = ids; pl.updated = Date.now(); saveData(); emit('playlists'); after?.(); });
}
export function likedDupes(after) {
  dupesDialog('Polubione', S.data.liked, (ids) => { S.data.liked = ids; saveData(); emit('liked'); after?.(); });
}

/** Przegląd całej biblioteki: playlisty i polubione z duplikatami */
export function scanAllDupes() {
  const rows = [];
  const lk = findDuplicates(tracksOf(S.data.liked)).length;
  if (lk) rows.push({ name: 'Polubione', n: lk, open: () => likedDupes() });
  for (const p of S.data.playlists) {
    const n = findDuplicates(p.trackIds.map((id) => tracksOf([id])[0] || null)).length;
    if (n) rows.push({ name: p.name, n, open: () => playlistDupes(p) });
  }
  if (!rows.length) return toast('Brak duplikatów w playlistach i polubionych 👍');
  const m = modal([
    h('h3', { html: `${icon('copy')} Duplikaty w bibliotece` }),
    h('p', { text: 'Wybierz playlistę, żeby przejrzeć i usunąć powtórzenia.' }),
    h('div.dupes', null, ...rows.map((r) => h('button.dupe-pl', { on: { click: () => { m.close(); r.open(); } } },
      h('span', { text: r.name }), h('span.muted', { text: `${r.n} ${r.n === 1 ? 'powtórzenie' : 'powtórzeń'}` })))),
    h('div.modal-actions', null, btn('Zamknij', { cls: 'ghost', onClick: () => m.close() })),
  ]);
}
