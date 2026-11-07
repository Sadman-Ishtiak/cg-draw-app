#!/bin/bash
# Dev launcher: sysroot env for building/running without sudo.
# (Runtime libs are system-wide; the sysroot supplies dev headers/.pc/symlinks.)
export PKG_CONFIG_PATH=/home/sadman/.local/share/cg-sysroot/root/usr/lib/x86_64-linux-gnu/pkgconfig:/home/sadman/.local/share/cg-sysroot/root/usr/lib/pkgconfig:/home/sadman/.local/share/cg-sysroot/root/usr/share/pkgconfig
export DISPLAY="${DISPLAY:-:0}"
cd "$(dirname "$0")/src-tauri" || exit 1
exec cargo run "$@"
