# JustMusic 🎵

Odtwarzacz muzyki – YouTube, Spotify (import), pliki lokalne, pobieranie offline, pluginy
i pełna customizacja wyglądu. Działa na **Windows, Linux i macOS**. Wszystkie dane zostają na Twoim komputerze.

## Funkcje

| | |
|---|---|
| 📥 **Import** | playlisty YouTube / YouTube Music (także kilka naraz, polubione z konta), Spotify, M3U |
| 🔎 **Wyszukiwarka** | YouTube / YouTube Music + Twoja biblioteka + playlisty w jednym miejscu, historia wyszukiwań, wklejanie linków |
| 🟢 **Spotify** | import playlist, albumów, utworów i wykonawców – utwory są automatycznie dopasowywane do nagrań z YouTube (bez Premium) |
| ⬇️ **Pobieranie** | M4A / MP3 / OPUS, kolejka z postępem, równoległe pobieranie, czyste tagi i okładki, odtwarzanie offline |
| 📁 **Pliki lokalne** | foldery z muzyką (MP3, FLAC, M4A, OGG, OPUS, WAV…), przeciąganie plików do okna, albumy i wykonawcy, import/eksport M3U |
| 📝 **Playlisty** | tworzenie jednym kliknięciem, przeciąganie utworów na playlistę w menu, zmiana kolejności drag & drop, zaznaczanie wielu (Ctrl/Shift), szybkie dodawanie z wyszukiwarki w playliście, „zapisz wyniki / kolejkę jako playlistę” |
| 🔖 **Zakładki** | momenty w utworach (Ctrl+B, z notatką), utwory, playlisty, wyszukiwania i linki; znaczniki momentów na pasku postępu |
| 🎨 **Customizacja** | 11 motywów, własne kolory, kolor akcentu, dynamiczny akcent z okładki, tło ambient, efekt szkła, zaokrąglenia, czcionki, gęstość, kształt okładek, własny CSS, udostępnianie motywów |
| 🧩 **Układ paneli** | menu po lewej/prawej, odtwarzacz na górze/dole, panel kolejki, kompaktowe menu, zmiana szerokości paneli myszą, wybór sekcji |
| 🔌 **Pluginy** | sklep z pluginami (aplikacja startuje bez nich): Discord, OhManyKeybinds, EvenMoreColors, GoToSleep, Bouncy, Teksty piosenek, Wyłącznik czasowy, Wizualizer + API dla własnych |
| 🖥️ **System** | ikona w zasobniku, zamykanie do zasobnika, postęp i przyciski na pasku zadań, skrót w menu (do przypięcia), autostart, przyciski okna w stylu aplikacji |
| 🔄 **Aktualizacje** | automatyczne sprawdzanie i instalacja nowych wersji z GitHuba |
| 💬 **Feedback** | opinie i krótka ankieta wysyłane prosto do autora – bez zakładania konta |
| 👋 **Ekran powitalny** | wygląd, układ, silnik (yt-dlp + ffmpeg jednym kliknięciem), foldery, pluginy i system przy pierwszym uruchomieniu |
| 🎚️ **Dźwięk** | 10-pasmowy korektor z presetami, wyrównywanie głośności utworów (pomiar LUFS przez ffmpeg), płynne przejścia (crossfade) i odtwarzanie bez przerw (gapless), płynne wyciszanie, wznawianie sesji |
| 🪟 **Mini odtwarzacz** | małe okno z okładką i sterowaniem, zawsze na wierzchu (także KDE Wayland), pasek lub duża okładka, głośność kółkiem myszy |
| ⚡ **Wydajność** | czysty JS bez frameworka, wirtualizowane listy (tysiące utworów bez spadków), leniwe ładowanie okładek, przyrostowe skanowanie biblioteki |
| ⌨️ **Sterowanie** | skróty klawiszowe, klawisze multimedialne, integracja z systemem (MPRIS na Linuksie, SMTC na Windows, Centrum sterowania na macOS) |

## Instalacja

Pobierz najnowszą wersję ze strony **[Releases](https://github.com/kusiakbartek771/JustMusic/releases/latest)**:

| System | Plik | |
|---|---|---|
| Windows | `JustMusic-Installer.exe` | mały instalator (~1–2 MB) – sam pobiera aplikację, **idealny do wysłania na Discordzie** |
| Windows | `JustMusic-…-portable.exe` | wersja przenośna, bez instalacji |
| Linux | `JustMusic-Installer-linux-mac.sh` | mały instalator: `bash JustMusic-Installer-linux-mac.sh` (albo `chmod +x` i dwuklik) |
| Linux | `JustMusic-x86_64.AppImage` / `.deb` / `.pacman` | pełne paczki |
| macOS | `JustMusic-Installer-linux-mac.sh` lub `.dmg` | (aplikacja nie jest podpisana – przy `.dmg` otwórz ją prawym przyciskiem → Otwórz) |

Albo jednym poleceniem w terminalu (Linux/macOS):

```bash
curl -fsSL https://raw.githubusercontent.com/kusiakbartek771/JustMusic/main/installer/install.sh | bash
```

### Aktualizacje
JustMusic sam sprawdza aktualizacje przy starcie i co 6 godzin (Ustawienia → O aplikacji).
Windows (instalator) i Linux (AppImage) pobierają i instalują nową wersję jednym kliknięciem;
pozostałe wersje otwierają stronę z odpowiednim plikiem.

### Wydawanie nowej wersji (dla autora)
1. Zmień `version` w `package.json` (np. `1.2.0`).
2. `git commit -am "v1.2.0" && git tag v1.2.0 && git push && git push --tags`
3. GitHub Actions zbuduje wersje na Windows, Linux i macOS i opublikuje je w Releases –
   wszyscy użytkownicy dostaną powiadomienie o aktualizacji.

## Uruchomienie (tryb deweloperski)

Wymagany **Node.js 20+** i **npm**.

```bash
npm install
npm start
```

> Arch / CachyOS: jeśli brakuje `npm`, zainstaluj go: `sudo pacman -S npm`.

Przy pierwszym uruchomieniu:
1. Kliknij **„Zainstaluj teraz”** na stronie startowej (lub Ustawienia → Pobieranie) – aplikacja pobierze
   oficjalną binarkę **yt-dlp** z GitHuba. Jeśli masz yt-dlp w systemie, zostanie użyty automatycznie.
2. *(Opcjonalnie)* zainstaluj **ffmpeg**, aby pobierać w MP3/OPUS z okładkami i tagami:
   - Windows: `winget install ffmpeg`
   - macOS: `brew install ffmpeg`
   - Linux: `sudo apt install ffmpeg` / `sudo pacman -S ffmpeg`

## Budowanie instalatorów

```bash
npm run dist:linux   # AppImage, .deb, .pacman
npm run dist:win     # mały instalator sieciowy (.exe) + wersja portable
npm run dist:mac     # .dmg + .zip
```

Pliki trafią do `dist/`. Instalator dla danego systemu najlepiej budować na tym systemie
(macOS wymaga budowania na Macu). Budowanie dla Windows z Linuksa wymaga Wine.

> npm 11+ może blokować skrypty instalacyjne – przy budowaniu na Windows zatwierdź je: `npm install-scripts approve electron-winstaller`.

## Spotify – jak to działa?

JustMusic odczytuje **tylko metadane** (tytuł, wykonawca, długość) i dopasowuje każdy utwór do nagrania
na YouTube (dopasowania są zapamiętywane). Bez kluczy API import działa dla publicznych playlist
do ~50 utworów. Dla pełnych playlist dodaj darmowe klucze w **Ustawienia → Spotify**
(developer.spotify.com/dashboard → Create app).

## Struktura projektu

```
src/main/        proces główny Electron (okno, IPC, yt-dlp, Spotify, biblioteka, protokół jm://)
src/renderer/    interfejs (HTML/CSS + moduły ES, bez frameworka)
store/          katalog sklepu z pluginami + dokumentacja API (store/README.md)
assets/          ikona aplikacji
```

Dane użytkownika (ustawienia, playlisty, zakładki, pluginy użytkownika) są w folderze danych aplikacji:
Linux `~/.config/JustMusic`, Windows `%APPDATA%\JustMusic`, macOS `~/Library/Application Support/JustMusic`.

## Feedback i ankieta

Opinie i ankiety trafiają na kanał Discord przez webhook. Adres webhooka **nie jest w repozytorium** –
GitHub Actions wstawia go przy budowaniu z sekretu `FEEDBACK_WEBHOOK`:

```bash
gh secret set FEEDBACK_WEBHOOK   # wklej adres webhooka z: Discord → kanał → Integracje → Webhooki
```

Lokalnie można go podać zmienną `JM_FEEDBACK_WEBHOOK`. Bez webhooka okno opinii pozwala
otworzyć zgłoszenie na GitHubie, skopiować je lub zapisać do pliku.

## Diagnostyka

```bash
npm run dev                         # z narzędziami deweloperskimi
JM_DEBUG=1 npm start                # logi interfejsu w terminalu
```

## Uwagi prawne

JustMusic to narzędzie – korzystaj z niego zgodnie z prawem autorskim i regulaminami serwisów.
Pobieraj tylko treści, do których masz prawo (np. muzykę na wolnych licencjach, własne nagrania,
treści, na których pobranie zezwala autor).

Licencja: MIT
