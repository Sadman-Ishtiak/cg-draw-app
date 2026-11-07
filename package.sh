#!/bin/bash
# package.sh — build a portable Linux distribution of cg-draw-app.
#
# Produces dist/cg-draw-app-linux-x86_64.tar.gz containing:
#   cg-draw-app          the Tauri binary
#   emsdk/               the bundled Emscripten toolchain (offline compiler)
#   shim/                graphics.h shim + JS library
#   examples/            starter sample programs
#   ui/                  frontend (also embedded in the binary)
#   run.sh               launcher that sets the toolchain env
#
# Fully offline: no network access at build or run time (beyond apt for deps).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
DIST="$ROOT/dist"
NAME="cg-draw-app-linux-x86_64"
STAGE="$DIST/$NAME"

echo "== building release binary =="
export PKG_CONFIG_PATH=/home/sadman/.local/share/cg-sysroot/root/usr/lib/x86_64-linux-gnu/pkgconfig:/home/sadman/.local/share/cg-sysroot/root/usr/lib/pkgconfig:/home/sadman/.local/share/cg-sysroot/root/usr/share/pkgconfig
( cd "$ROOT/src-tauri" && cargo build --release )

echo "== staging $STAGE =="
# the copied emsdk contains read-only files and rm -rf can race on some
# filesystems; make the tree writable and retry the removal.
[ -e "$STAGE" ] && chmod -R u+w "$STAGE" 2>/dev/null || true
for _ in 1 2 3; do
  rm -rf "$STAGE" 2>/dev/null && break
  chmod -R u+w "$STAGE" 2>/dev/null || true
  find "$STAGE" -depth -delete 2>/dev/null || true
done
mkdir -p "$STAGE"
cp "$ROOT/src-tauri/target/release/cg-draw-app" "$STAGE/"
cp -r "$ROOT/shim" "$STAGE/"
cp -r "$ROOT/examples" "$STAGE/"
cp -r "$ROOT/ui" "$STAGE/"

echo "== bundling emsdk (the offline compiler) =="
# The full emsdk is large; copy the upstream toolchain + node the app needs.
mkdir -p "$STAGE/emsdk"
cp -r "$ROOT/emsdk/upstream" "$STAGE/emsdk/"
cp -r "$ROOT/emsdk/node" "$STAGE/emsdk/" 2>/dev/null || true
# The emsdk-embedded config is how emcc finds LLVM_ROOT/BINARYEN_ROOT/NODE_JS:
# its search looks two levels up from emcc (emsdk/upstream/emscripten -> emsdk).
# Without it a packaged toolchain fails with "BINARYEN_ROOT not set in config".
# $CFGDIR in the config expands to the directory holding it, so the copy keeps
# working from any install location.
cp "$ROOT/emsdk/.emscripten" "$STAGE/emsdk/"

echo "== bundling the GTK/WebKit runtime (cglibs) =="
# Makes the tarball fully self-contained: no webkit2gtk/GTK3 packages needed
# on the target machine — only glibc (libc/libm) remain system-level.
"$ROOT/bundle-cglibs.sh" "$STAGE/cglibs"

cat > "$STAGE/run.sh" <<'EOF'
#!/bin/bash
# Launch cg-draw-app. Sets CGD_EMSDK so the app finds the bundled toolchain,
# CGD_SHIM for the graphics shim, and EM_CONFIG so the bundled emcc always uses
# the bundled configuration — independent of the current directory.
HERE="$(cd "$(dirname "$0")" && pwd)"
export CGD_EMSDK="$HERE/emsdk"
export CGD_SHIM="$HERE/shim"
export EM_CONFIG="$HERE/emsdk/.emscripten"
# the whole GTK/WebKit runtime is bundled in cglibs/ (no system packages
# needed beyond glibc); the launcher puts it first in the search path.
export LD_LIBRARY_PATH="$HERE/cglibs${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
exec "$HERE/cg-draw-app" "$@"
EOF
chmod +x "$STAGE/run.sh"

cat > "$STAGE/README.txt" <<'EOF'
cg-draw-app — offline code editor + animated BGI canvas for a CG course.

Run:      ./run.sh

Fully self-contained: the C++ compiler (Emscripten), the graphics shim, the
sample programs AND the GTK/WebKit runtime are all bundled (see cglibs/).
The only system requirement is glibc. No network access is needed at any point.

Windows note: the Windows build is a single self-extracting .exe and needs the
WebView2 runtime, which ships with current Windows 10/11. If SmartScreen warns
on first launch, choose "More info" -> "Run anyway" (the exe is unsigned).
EOF

echo "== creating tarball =="
tar -C "$DIST" -czf "$DIST/$NAME.tar.gz" "$NAME"
ls -lh "$DIST/$NAME.tar.gz"
echo "PACKAGE_OK: $DIST/$NAME.tar.gz"
