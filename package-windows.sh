#!/bin/bash
# package-windows.sh — build the portable Windows distribution of cg-draw-app.
#
# Produces dist/cg-draw-app-windows-x86_64.zip containing:
#   cg-draw-app.exe    the native Windows Tauri binary (cross-built on host)
#   run.exe            native launcher: sets CGD_EMSDK/CGD_SHIM + starts the app
#   emsdk/             the bundled Emscripten toolchain (flat: upstream+node+.emscripten)
#   shim/              graphics.h shim + JS library
#   examples/          starter sample programs
#   ui/                frontend (also embedded in the .exe)
#   README.txt
#
# NOTE: run.exe is the primary entry point (replaces the old run.bat).
# Prereqs built on host: cross-compiled cg-draw-app.exe + statically-linked run.exe.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
STAGE="$ROOT/dist/cg-draw-app-windows-x86_64"
ZIP="$ROOT/dist/cg-draw-app-windows-x86_64.zip"

EXE="$ROOT/src-tauri/target/x86_64-pc-windows-gnu/release/cg-draw-app.exe"
RUN="$ROOT/windows/run.exe"
[ -f "$EXE" ] || { echo "missing cross-built exe: $EXE (run the cargo build first)"; exit 1; }
[ -f "$RUN" ] || { echo "missing run.exe: $RUN (compile windows/launcher.c first)"; exit 1; }

echo "== staging $STAGE =="
[ -e "$STAGE" ] && chmod -R u+w "$STAGE" 2>/dev/null || true
rm -rf "$STAGE"
mkdir -p "$STAGE/emsdk"
cp "$EXE" "$STAGE/"
cp "$RUN" "$STAGE/"
cp -r "$ROOT/shim" "$STAGE/"
cp -r "$ROOT/examples" "$STAGE/"
cp -r "$ROOT/ui" "$STAGE/"

echo "== bundling emsdk (flat layout, mirrors package.sh) =="
cp -r "$ROOT/emsdk/upstream" "$STAGE/emsdk/"
cp -r "$ROOT/emsdk/node" "$STAGE/emsdk/"
cp "$ROOT/emsdk/.emscripten" "$STAGE/emsdk/"

cat > "$STAGE/README.txt" <<'EOF'
CG Draw - offline code editor + animated BGI canvas for a CG course.

Run:      double-click run.exe    (or cg-draw-app.exe)
Build:    unsigned. If SmartScreen warns: "More info" -> "Run anyway".

Everything - the C++ compiler (Emscripten), the graphics shim and the sample
programs - is bundled here. No install needed. Requires the WebView2 runtime
(ships with current Windows 10/11).
EOF

echo "== creating zip =="
rm -f "$ZIP"
( cd "$ROOT/dist" && zip -qr "$(basename "$ZIP")" "$(basename "$STAGE")" )
ls -lh "$ZIP"
echo "PACKAGE_OK: $ZIP"
