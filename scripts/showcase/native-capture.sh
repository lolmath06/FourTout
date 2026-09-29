#!/usr/bin/env bash
# Captures de l'application **native** (Tauri + WebKitGTK), sous Linux.
#
# Certains outils n'existent que dans l'application installée : empreintes,
# archives, inspection média (FFmpeg), diagnostic de fichiers. Ce script lance
# le vrai binaire dans un écran virtuel (Xvfb), le pilote au clavier et à la
# souris (xdotool) et capture la fenêtre (ImageMagick). Les fichiers sont
# choisis dans le vrai sélecteur GTK.
#
# Fenêtre : 1280 × 800 en 2× (GDK_SCALE=2) → showcase-output/raw/<scène>-<thème>.png
# en 2560 × 1600, exactement comme capture.mjs.
#
# Prérequis (Debian/Ubuntu) :
#   apt install xvfb xdotool xclip imagemagick dbus-x11 ffmpeg zip \
#     libwebkit2gtk-4.1-dev libsoup-3.0-dev libgtk-3-dev librsvg2-dev
#   pnpm dev            (le binaire de développement charge http://localhost:1420)
#   cargo build --release --manifest-path src-tauri/Cargo.toml
#
# Usage : scripts/showcase/native-capture.sh [chemin/du/binaire]
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
BIN="${1:-${CARGO_TARGET_DIR:-$ROOT/src-tauri/target}/release/fourtout}"
RAW="$ROOT/showcase-output/raw"
# Dossier de démonstration au chemin neutre : il apparaît dans les captures.
DEMO_HOME="${DEMO_HOME:-/home/demo}"
DISPLAY_NUM=":97"
mkdir -p "$RAW"

# ------------------------------------------------------------ fichiers fictifs
mkdir -p "$DEMO_HOME/Documents" "$DEMO_HOME/Videos"
cp "$ROOT"/showcase-output/fixtures/*.pdf "$ROOT/showcase-output/fixtures/paysage-exemple.jpg" "$DEMO_HOME/Documents/"
(cd "$DEMO_HOME/Documents" && rm -f archive-exemple.zip && zip -q archive-exemple.zip ./*.pdf paysage-exemple.jpg)
head -c 20000 "$DEMO_HOME/Documents/archive-exemple.zip" > "$DEMO_HOME/Documents/archive-abimee.zip"
ffmpeg -y -loglevel error -f lavfi -i "smptehdbars=size=1920x1080:rate=30" \
  -f lavfi -i "sine=frequency=440:sample_rate=48000" -t 12 \
  -c:v libx264 -pix_fmt yuv420p -c:a aac -b:a 128k \
  "$DEMO_HOME/Videos/presentation-exemple.mp4"

# ------------------------------------------------------------ pilotage
S=2 # facteur d'échelle : les coordonnées ci-dessous sont en pixels logiques.

click() { xdotool mousemove $(($1 * S)) $(($2 * S)) click 1; sleep "${3:-0.4}"; }
park() { xdotool mousemove $((1279 * S)) $((799 * S)); sleep 0.6; }

# Ouvre un outil par la recherche de l'accueil : Entrée ouvre le premier résultat.
# Requêtes sans accents : xdotool les tape mal, et la recherche les ignore.
open_tool() {
  click 60 62 0.8          # Accueil
  click 640 61 0.3         # champ « Que voulez-vous faire ? »
  xdotool key ctrl+a
  xdotool type --delay 25 "$1"
  sleep 0.8
  xdotool key Return
  sleep 1.5
}

# Choisit un fichier dans le sélecteur GTK ouvert par la zone de dépôt.
# Le chemin est collé, pas tapé : l'autocomplétion du sélecteur insère sinon
# son propre texte au milieu de la saisie.
pick_file() {
  printf '%s' "$2" | xclip -selection clipboard
  click 640 "$1" 2.5       # zone de dépôt de l'outil
  xdotool key ctrl+l
  sleep 0.3
  xdotool key ctrl+a ctrl+v
  sleep 0.4
  xdotool key Return
  sleep "${3:-3}"
}

shot() {
  park
  import -window root -crop "$((1280 * S))x$((800 * S))+0+0" +repage "$RAW/$1-$THEME.png"
  echo "✓ $1 ($THEME)"
}

run_theme() {
  THEME="$1"
  local gtk_theme="Adwaita"
  [[ "$THEME" == "dark" ]] && gtk_theme="Adwaita:dark"

  Xvfb "$DISPLAY_NUM" -screen 0 2600x1700x24 >/dev/null 2>&1 &
  local xvfb=$!
  sleep 1.5
  export DISPLAY="$DISPLAY_NUM"
  dbus-run-session -- env GDK_SCALE=$S GTK_THEME="$gtk_theme" \
    WEBKIT_DISABLE_COMPOSITING_MODE=1 HOME="$DEMO_HOME" "$BIN" >/dev/null 2>&1 &
  local app=$!
  sleep 8
  local win
  win="$(xdotool search --onlyvisible --name '^FourTout$' | head -1)"
  xdotool windowmove "$win" 0 0 windowsize "$win" $((1280 * S)) $((800 * S))
  sleep 1.5

  # Fichiers & Archives — empreintes SHA-256 et SHA-512, calculées par Rust.
  open_tool "calculer une empreinte"
  pick_file 195 "$DEMO_HOME/Documents/rapport-annuel-exemple.pdf"
  click 520 317 0.2        # case SHA-512
  click 1150 490 7         # « Calculer l'empreinte » (puis la notification s'efface)
  shot fichiers

  # Archives — contenu d'une archive, sans l'extraire.
  open_tool "inspecter une archive"
  pick_file 312 "$DEMO_HOME/Documents/archive-exemple.zip" 1
  click 1154 412 3         # « Inspecter l'archive »
  shot archives

  # Média — ce que FFmpeg lit réellement dans le fichier.
  open_tool "inspecter un media"
  pick_file 194 "$DEMO_HOME/Videos/presentation-exemple.mp4" 5
  shot media

  # Diagnostic — une archive tronquée.
  open_tool "diagnostiquer un fichier"
  pick_file 246 "$DEMO_HOME/Documents/archive-abimee.zip" 5
  shot diagnostic

  kill "$app" 2>/dev/null || true
  pkill -x fourtout 2>/dev/null || true
  kill "$xvfb" 2>/dev/null || true
  sleep 1
}

for theme in ${THEMES:-light dark}; do run_theme "$theme"; done
