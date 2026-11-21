# Pluginy JustMusic

JustMusic startuje **bez pluginów** – instaluje się je ze sklepu (Ustawienia → Pluginy).
Sklep pobiera pluginy **z tego folderu na GitHubie** (`store/catalog.json`), więc nowe pluginy
i ich aktualizacje trafiają do użytkowników bez wydawania nowej wersji aplikacji.
Kopia folderu jest też dołączona do aplikacji – sklep działa offline.

### Dodawanie / aktualizacja pluginu
1. Dodaj lub zmień folder `store/<id>/` (nazwa folderu = `id` z manifestu) i podbij `version` w `manifest.json`.
2. `npm run catalog` – odświeża `store/catalog.json`.
3. `git commit` i `git push` – użytkownicy zobaczą „Aktualizuj” w sklepie.

Ten folder (`store/`) to katalog sklepu. Można też podać zdalny katalog
(`catalog.json` przez HTTPS) w Ustawienia → Pluginy → Zaawansowane, albo w `package.json` → `justmusic.pluginCatalogUrl`:

```json
{ "plugins": [ { "id": "moj-plugin", "name": "Mój plugin", "version": "1.0.0", "short": "…",
                 "files": ["manifest.json", "index.js"], "baseUrl": "https://example.com/plugins/moj-plugin/" } ] }
```

Plugin to folder z dwoma plikami:

```
moj-plugin/
├── manifest.json
└── index.js        (+ opcjonalnie style.css)
```

Własny plugin wrzuć do **folderu pluginów** (Ustawienia → Pluginy → „Folder pluginów”),
kliknij **Przeładuj** i włącz go przełącznikiem.

## manifest.json

```json
{
  "id": "moj-plugin",
  "name": "Mój plugin",
  "version": "1.0.0",
  "short": "Jedno zdanie do karty w sklepie",
  "description": "Dłuższy opis (lista funkcji)",
  "icon": "puzzle",
  "tags": ["tag"],
  "author": "Ty",
  "main": "index.js",
  "style": "style.css"
}
```

## index.js

Moduł ES z domyślnie eksportowaną funkcją `activate(api)`. Może zwrócić funkcję
sprzątającą wywoływaną przy wyłączeniu pluginu. Wszystko, co zarejestrujesz przez `api`
(przyciski, widoki, style, nasłuchiwanie zdarzeń), jest sprzątane automatycznie.

```js
export default function activate(api) {
  api.ui.addPlayerButton({
    id: 'hello', icon: 'sparkles', title: 'Cześć!',
    onClick: () => api.ui.toast(`Gra: ${api.player.current?.title ?? 'nic'}`),
  });
}
```

## API

### `api.player`
| | |
|---|---|
| `current` | aktualny utwór `{ id, title, artist, album, duration, thumb, source, ytId?, path? }` |
| `playing`, `time`, `duration`, `volume`, `queue`, `audio` | stan odtwarzacza (`audio` to element `<audio>`) |
| `play(tracks, start?)`, `enqueue(tracks, next?)` | odtwarzanie / kolejka |
| `toggle()`, `pause()`, `resume()`, `next()`, `prev()`, `seek(sec)`, `setVolume(0..1)` | sterowanie |
| `on(event, fn)` | zdarzenia: `track`, `state`, `time` (~4/s), `queue`, `volume`, `loading`; zwraca funkcję odpinającą |

- `duck(factor, ms)` – tymczasowe przyciszenie (0–1) bez zmiany ustawienia głośności; `duck(1)` przywraca

### `api.commands`
- `list()`, `run(id)`, `register({ id, label, run })` – polecenia, które można przypisać do skrótów (OhManyKeybinds)
- `setDefaultShortcuts(bool)` – włącza/wyłącza wbudowane skróty

### `api.themes`
- `add(id, { name, bg, surface, 'surface-2', elevated, text, 'text-dim', accent, 'accent-text', border })`
- `apply(id)`, `applyCustom(vars)`, `current`, `vars`, `all`

### `api.system`
- `idle()` → `{ seconds, state }` – bezczynność całego systemu
- `globalShortcut(accelerator, commandId)` – skrót globalny (format Electron, np. `Control+Alt+P`)
- `platform`

### `api.discord`
- `connect(appId)`, `disconnect()`, `setActivity(activity | null)`, `status()`
- `voice({ enabled, secret, interactive })` – nasłuch mówiących na kanale głosowym
- `on(fn)` – zdarzenia `{ type: 'status' | 'error' | 'speaking' | 'speaking-reset', payload }`

### `api.bus`
- `emit(event, payload)`, `on(event, fn)`, `last(event)` – komunikacja między pluginami (np. `afk`)

### `api.audio`
- `getAnalyser()` – `AnalyserNode` Web Audio (po korektorze) – do wizualizacji.

### `api.library`
- `getTrack(id)`, `local`, `liked`, `history`, `playlists`
- `createPlaylist(name, tracks)`, `addToPlaylist(playlistId, tracks)`
- `search(query, limit)` – wyszukiwanie w YouTube (zwraca utwory)

### `api.ui`
- `addView({ id, title, icon, render(el) })` – nowy widok z pozycją w menu bocznym; `render` może zwrócić funkcję sprzątającą
- `openView(id)`, `navigate(name, param)`
- `addPlayerButton({ id, icon, title, onClick(event, el) })` → `{ el, setActive, setIcon, setTitle }`
- `addTitlebarItem({ id, icon, text, title, onClick })` → `{ set, show, remove }` – znacznik statusu na górnym pasku
- `addTrackMenuItem({ label, icon, onClick(tracks) })` – pozycja w menu kontekstowym utworu
- `addSettings(render(el))` – własny panel w Ustawienia → Pluginy
- `addStyle(css)`, `toast(msg, opts)`, `modal(content)`, `prompt({...})`, `confirm({...})`, `popover(anchor, content)`, `contextMenu(event, items)`
- pomocnicze: `api.h(tag, props, ...children)`, `api.icon(name)`, `api.esc(str)`, `api.fmtTime(sec)`

### `api.widgets` (JustMusic 1.4.0+)
Widżety na pulpicie: przezroczyste okna bez ramki, zawsze na wierzchu, na wszystkich pulpitach.
Treść to strona HTML z folderu pluginu; rozmawia z pluginem przez `window.jmw`
(`onMessage(fn)`, `post(msg)`, `resize(w, h)`, `focusApp()`).
- `caps()` → `{ onTop, position, backend, displays }` – co potrafi system (np. GNOME/Wayland nie pozwala na „zawsze na wierzchu”)
- `open(id, { page, width, height, anchor, marginX, marginY, display, x, y, onTop, allDesktops, clickThrough, opacity, visible })` → uchwyt
  `{ post(msg), update(opts), on(fn), close() }`; zdarzenia: `{ type: 'message', msg }`, `{ type: 'moved', x, y }`, `{ type: 'closed' }`
- `anchor`: `top-left`, `top-center`, `top-right`, `center-left`, `center`, `center-right`, `bottom-left`, `bottom-center`, `bottom-right` albo `free` (wtedy `x`, `y`)
- przeciąganie: CSS `-webkit-app-region: drag` (przyciski: `no-drag`)

### `api.storage`
- `get(key, default)`, `set(key, value)` – trwałe dane pluginu (zapisywane w ustawieniach)

### `api.http`
- `text(url)`, `json(url)` – żądania HTTPS przez proces główny (bez ograniczeń CORS)

## Ikony
Dostępne nazwy: `play, pause, next, prev, shuffle, repeat, heart, bookmark, download, search, home, library,
list, listMusic, plus, settings, trash, x, more, volume, queue, puzzle, palette, layout, brush, folder,
link, music, disc, user, video, check, clock, sliders, edit, external, upload, moon, mic, activity,
copy, refresh, shield, sparkles, keyboard, info, alert, history, globe, eye, file`.

## Bezpieczeństwo
Pluginy działają w procesie interfejsu (bez dostępu do Node.js / systemu plików),
ale mają dostęp do Twoich danych w aplikacji. Instaluj tylko pluginy, którym ufasz.
