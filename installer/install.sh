#!/usr/bin/env bash
# JustMusic – mały instalator (Linux / macOS).
# Pobiera najnowszą wersję z GitHuba, instaluje ją dla bieżącego użytkownika i uruchamia.
# Użycie:  bash JustMusic-Installer-linux-mac.sh
set -euo pipefail

REPO="kusiakbartek771/JustMusic"
API="https://api.github.com/repos/${REPO}/releases/latest"

say()  { printf '\033[1;35m♪\033[0m %s\n' "$*"; }
fail() { printf '\033[1;31m✗ %s\033[0m\n' "$*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || fail "Brak programu: $1"; }

need curl
OS="$(uname -s)"
ARCH="$(uname -m)"

say "Sprawdzam najnowszą wersję JustMusic…"
JSON="$(curl -fsSL -H 'Accept: application/vnd.github+json' "$API")" || fail "Nie udało się połączyć z GitHubem"
TAG="$(printf '%s' "$JSON" | grep -m1 '"tag_name"' | sed -E 's/.*"tag_name": *"([^"]+)".*/\1/')"
urls() { printf '%s' "$JSON" | grep '"browser_download_url"' | sed -E 's/.*"(https:[^"]+)".*/\1/'; }
[ -n "$TAG" ] || fail "Nie znaleziono wydania"
say "Najnowsza wersja: ${TAG}"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

if [ "$OS" = "Linux" ]; then
  case "$ARCH" in
    x86_64|amd64) PAT='x86_64\.AppImage$' ;;
    aarch64|arm64) PAT='arm64\.AppImage$' ;;
    *) fail "Nieobsługiwana architektura: $ARCH" ;;
  esac
  URL="$(urls | grep -E "$PAT" | head -n1)"
  [ -n "$URL" ] || fail "Brak pliku AppImage dla $ARCH w wydaniu ${TAG}"

  DEST_DIR="${HOME}/Applications"
  DEST="${DEST_DIR}/JustMusic.AppImage"
  mkdir -p "$DEST_DIR"
  say "Pobieram aplikację…"
  curl -fL --progress-bar -o "$TMP/JustMusic.AppImage" "$URL"
  chmod +x "$TMP/JustMusic.AppImage"
  mv -f "$TMP/JustMusic.AppImage" "$DEST"

  # ikona + wpis w menu aplikacji (do przypięcia na pasku zadań)
  DATA="${XDG_DATA_HOME:-$HOME/.local/share}"
  mkdir -p "$DATA/applications" "$DATA/icons/hicolor/512x512/apps"
  curl -fsSL -o "$DATA/icons/hicolor/512x512/apps/justmusic.png" "https://raw.githubusercontent.com/${REPO}/main/assets/icon.png" || true
  cat > "$DATA/applications/justmusic.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=JustMusic
GenericName=Odtwarzacz muzyki
Comment=Odtwarzacz muzyki – YouTube, Spotify, pliki lokalne
Exec="${DEST}" %U
Icon=justmusic
Terminal=false
Categories=AudioVideo;Audio;Player;Music;
StartupWMClass=JustMusic
EOF
  command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database "$DATA/applications" >/dev/null 2>&1 || true

  # AppImage wymaga FUSE 2 – podpowiedź, jeśli go brakuje
  if ! ldconfig -p 2>/dev/null | grep -q 'libfuse.so.2'; then
    say "Uwaga: AppImage potrzebuje biblioteki FUSE 2 (Arch: sudo pacman -S fuse2, Ubuntu: sudo apt install libfuse2)."
  fi
  say "Zainstalowano: ${DEST}"
  say "Uruchamiam JustMusic…"
  nohup "$DEST" >/dev/null 2>&1 &
elif [ "$OS" = "Darwin" ]; then
  case "$ARCH" in
    arm64) PAT='arm64\.zip$' ;;
    *) PAT='x64\.zip$' ;;
  esac
  URL="$(urls | grep -E "$PAT" | head -n1)"
  [ -n "$URL" ] || URL="$(urls | grep -E '\.zip$' | grep -v arm64 | head -n1)"
  [ -n "$URL" ] || fail "Brak pliku dla macOS w wydaniu ${TAG}"
  say "Pobieram aplikację…"
  curl -fL --progress-bar -o "$TMP/app.zip" "$URL"
  ditto -x -k "$TMP/app.zip" "$TMP/app"
  DEST="${HOME}/Applications"
  mkdir -p "$DEST"
  rm -rf "$DEST/JustMusic.app"
  mv "$TMP/app/JustMusic.app" "$DEST/"
  xattr -dr com.apple.quarantine "$DEST/JustMusic.app" 2>/dev/null || true
  say "Zainstalowano: $DEST/JustMusic.app"
  open "$DEST/JustMusic.app"
else
  fail "Ten instalator jest dla Linuksa i macOS. Na Windows użyj JustMusic-Installer.exe."
fi
say "Gotowe! Miłego słuchania 🎵"
