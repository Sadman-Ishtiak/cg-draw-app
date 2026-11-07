#!/bin/bash
# bundle-cglibs.sh <target-dir> — copy the app's full shared-library runtime
# closure (webkit2gtk/GTK3 stack + webkit helper processes) into <target-dir>/cglibs,
# plus the webkit2gtk-4.1 helper dir. Leaves only glibc (libc/libm) system-level.
#
# Used so the packaged app can run on a machine with none of the GTK/WebKit
# packages installed: the launcher just sets LD_LIBRARY_PATH=<dir>/cglibs.
# Requires: the release binary present on the host (ldd closure computed from it).
set -euo pipefail
TARGET="$(cd "$(dirname "$1")" && pwd)/$(basename "$1")"
BIN="${BIN:-$(cd "$(dirname "$0")" && pwd)/src-tauri/target/release/cg-draw-app}"
[ -x "$BIN" ] || { echo "missing release binary: $BIN"; exit 1; }
mkdir -p "$TARGET"
python3 - "$BIN" "$TARGET" <<'EOF'
import subprocess, os, shutil, sys
bin_path, cglibs = sys.argv[1], sys.argv[2]

def lines(p):
    out = subprocess.run(["ldd", p], capture_output=True, text=True).stdout
    for line in out.splitlines():
        f = line.split("=>", 1)
        if len(f) != 2:
            continue
        fields = f[1].split()
        if fields and os.path.exists(fields[0]):
            yield f[0].strip(), fields[0]  # soname, resolved path

keep = {"libc.so.6", "libm.so.6"}  # dynamic-loader level; cannot be bundled
seen, queue = set(), [bin_path]
copied = 0
while queue:
    cur = queue.pop()
    for soname, path in lines(cur):
        rp = os.path.realpath(path)
        if soname in keep or rp in seen:
            continue
        seen.add(rp)
        dst = os.path.join(cglibs, soname)
        if not os.path.exists(dst):
            shutil.copy2(rp, dst); copied += 1
        queue.append(dst)
print(f"cglibs: {copied} libs copied (closure of {len(seen)} unique real files)")

# webkit helper processes (WebProcess/NetworkProcess/GPUProcess) — bundled next
# to the webkit .so so the runtime spawns them from the bundle, not the system.
wdir = "/usr/lib/x86_64-linux-gnu/webkit2gtk-4.1"
if os.path.isdir(wdir):
    shutil.copytree(wdir, os.path.join(cglibs, "webkit2gtk-4.1"), dirs_exist_ok=True)
    print("cglibs: webkit2gtk-4.1 helper dir copied")
EOF
