# cg-draw-app — Build Plan (final, settled spec)

Offline code editor + animated canvas output for a Computer Graphics course
(Schaum's Outline / winbgi BGI style). One portable binary per OS, no backend,
no network. This document is the single source of truth for the build agent.

---

## 1. Product summary

- Student writes C++ (classes, `std::vector`, iostreams allowed) using a
  winbgi-compatible `graphics.h` subset.
- Press Run → app compiles with bundled Emscripten (`em++`) → `.wasm` runs in a
  Web Worker → every draw call streams to the main thread → the **drawing
  process animates live** on a canvas.
- Normal mode = plain code editor (full IDE-like freedom).
- Exam mode = same editor with input locks, encrypted time-gated saves.

## 2. Architecture

```
One native binary per OS (Tauri 2: Rust core + wry webview)
├─ Rust core: exam state machine, CGEX1 encrypt/decrypt, file I/O,
│   compile orchestration (spawns bundled em++), IPC commands
├─ Bundled Emscripten subset (em++ + sysroot + libs, offline):
│   student C++ → .wasm + glue JS
└─ Embedded webview (HTML+JS, minified, no network, devtools OFF):
    CodeMirror 6 (C++ mode), canvas player, console, speed toggle
```

- Execution: `.wasm` instantiated in a **Web Worker** (browser-native WASM; no
  Node, no wasmtime). Runaway code spins in the worker only — UI stays live.
- IPC: thin Tauri command set (~20 commands). No clipboard-read command exists.
- No HTTP anything. Fully offline, verified air-gapped.

## 3. Graphics shim (`graphics.h` + `graphics_glue.js`)

Winbgi-compatible subset. Only declared functions exist — anything else is a
compile-time error (by design, visible not silent).

Drawing: `putpixel(x,y,color)`, `line(x1,y1,x2,y2)` (winbgi standard: uses
current color via `setcolor`; NOTE — course handout may define
`line(px,py,qx,qy,color)`; shim edit is one line if so — **pending handout,
non-blocking**), `lineto`, `circle(x,y,r)`, `rectangle(l,t,r,b)`, `ellipse`,
`bar`, `floodfill` (only if book samples need it).
State: `setcolor`, `setbkcolor`, `setfillstyle`, `setlinestyle`, `getcolor`,
`getbkcolor`, `getpixel`, `getmaxx`, `getmaxy`.
Ceremony: `initgraph(&gd,&gm,"")` (no-op, empty path OK), `detectgraph` (no-op),
`closegraph()` (no-op), `initwindow(w,h,...)` (sets canvas size), `cleardevice`,
`delay(ms)`, `outtextxy`, `COLOR(r,g,b)`.
Constants: 16 BGI colors enum (`BLACK`..`WHITE`), `DETECT`, driver/mode enums
needed for the mode→size table, `SOLID_FILL` etc., `SOLID_LINE` etc.

Colors: 16 BGI palette + `0x03000000`-form RGB; mapped once to CSS colors.

Canvas: **program-defined** — `initwindow(w,h)` wins, else `initgraph` mode
table (VGAHI=640×480, EGAHI=640×350, …), else default **640×480**. Origin
top-left. Out-of-range coords clip silently (canvas default, matches BGI).
Right panel: scrollable, zoom `fit / 1:1 / 2×`.

## 4. Animation pipeline (F9/F10/F12)

- Worker stubs (`extern "C"` fns exported via `EXPORTED_FUNCTIONS`) post
  `{fn,args}` messages; `delay(ms)` posts `{wait:ms}` and busy-waits in the
  worker (worker-only freeze; on-screen pacing looks like real BGI).
- Main-thread player **batches**: flush once per frame (~60 fps) or every
  4 000 calls, whichever first → a 250k-`putpixel` program animates in seconds.
- Speed toggle: `1×` (waits respected) / `fast` (waits zero-length).
- **Stop button**: `worker.terminate()`, clears canvas. No auto-kill timer.

## 5. Files & modes

- **Multi-file tabs in BOTH modes** (exam assignments need it).
- Compile: all tabs → one `em++` invocation (temp dir per run).
- Normal save: each tab as its own plain `.cpp` / `.txt` (Save / Save All to a
  folder). PNG export available.
- Normal open: multi-select plain files; a `CGEX1` file prompts for passphrase.
- Exam save: **one CGEX1 bundle** — encrypted payload is a manifest
  `{filename → source}` of all tabs. Single file, single passphrase, single
  8 h clock.
- **Auto-save, both modes, every 60 s**: normal → the open file on disk
  (untitled work → session draft in app data dir; relaunch offers "recover
  unsaved work?" restoring all tabs); exam → the session bundle.

## 6. Encryption — `CGEX1` format (Rust: `aes-gcm`/`ring` + `pbkdf2`)

```
CGEX1\n
base64( salt(16) || iv(12) || created_at(8B unix)
      || wrapped_student_key(44) || wrapped_instructor_key(44)
      || ciphertext+tag )
```

- Random 32 B content key `C`; payload (manifest JSON) = AES-256-GCM under `C`.
- `C` wrapped twice: with PBKDF2(student_passphrase, salt, 100k) → student
  path; with PBKDF2(instructor_passphrase, salt_i) → instructor path.
- **Student open**: read `created_at` → if `now − created_at > 8 h` refuse
  immediately (clear expiry message, no passphrase prompt). Else passphrase →
  unwrap → decrypt; GCM tag fail = "invalid passphrase".
- Purpose: crash recovery within the window (6 h exam + 2 h buffer);
  files from previous exams unopenable without that exam's passphrase.
- **Instructor decrypt**: same app, "Decrypt (instructor)" command — prompts
  for instructor passphrase, **no time gate** (grading anytime). Instructor
  passphrase never stored in app or on disk.
- Instructor manual note: use a **fresh passphrase per exam session**.
- Known limits (documented, accepted): `created_at` from system clock (clock
  rollback is the shortcut); app-level gate = high-cost deterrence, not proof.

## 7. Exam mode behavior

- Start: in-app passphrase dialog (instructor-distributed). No URL flags.
- Input blocking (event-level, all vectors): Ctrl/Cmd+C/V/X, `copy`/`cut`/
  `paste` events, drag-and-drop text/files, right-click context menu, no paste
  menu item, open-file disabled, devtools disabled (Tauri config), stdout
  console read-only (not selectable), no PNG export.
- Exit: end code or app close.
- Only typed keyboard input enters the app in exam mode.
- Exam **config file** (authored in normal mode, shipped next to the exam):
  duration, starter code, reopen-allowed, filename convention
  (`rollno_exam.cpp`), aid toggles (grid overlay, insert toolbar).

## 8. Feature matrix (final)

| # | Feature | Normal | Exam |
|---|---|---|---|
| 1 | Stop button | ✅ | ✅ |
| 2 | Auto-save 60 s | ✅ plain | ✅ CGEX1 |
| 3 | Compile-error panel + jump-to-line | ✅ | ✅ |
| 4 | API autocomplete + signature tooltips | ✅ | ✅ |
| 5 | Pixel inspector (hover → x,y,color) | ✅ | ✅ |
| 6 | Exam config file | author | consume |
| 7 | BGI palette reference (16 swatches) | ✅ | ✅ |
| 8 | Grid/axes overlay toggle | ✅ | config |
| 9 | Insert-function toolbar | ✅ | config (default off) |
| 10 | Multi-file tabs | ✅ | ✅ |
| 14 | Filename convention | — | ✅ |

Removed by decision: GIF recording, reference-image compare, countdown timer.

## 9. Operational items

- **A. Compile feedback + cache**: "compiling…" state; cache `.wasm` by source
  hash so unchanged re-runs are instant.
- **B. Startup self-check**: bundled toolchain + webview verified on launch;
  clear one-line error otherwise.
- **C. Packaging realities**: Windows — unsigned exe SmartScreen note
  (document bypass; signing later), WebView2 runtime check/bootstrapper;
  Linux — webkit2gtk deps documented, AppImage needs libfuse2, ship `.tar.gz`
  fallback.
- **D. Acceptance checklist** (must pass before ship):
  1. Book sample programs compile + animate correctly.
  2. Air-gapped offline run.
  3. Exam E2E: start → code → auto-save → kill app → reopen within 8 h →
     refusal after 8 h → instructor decrypt.
  4. Input-block matrix verified per vector.
  5. Stop button kills a `while(1)` run; UI stays responsive.
  6. 250k-`putpixel` sample renders in seconds (batching works).
  7. Multi-file bundle round-trip (save → open → all tabs restored).
- **E. Panel layout persistence**: split position + zoom level remembered.

## 10. Build order

1. **Shim + glue + samples**: write `graphics.h` shim + `graphics_glue.js`;
   transpile the book's sample programs FIRST; grow the declared set only if a
   sample demands it. Include 3–5 starter examples as loadable templates.
2. **Rust app skeleton** (Tauri 2): window, embedded frontend, IPC commands,
   spawn-compiler plumbing, compile cache (A), self-check (B).
3. **Frontend**: CodeMirror editor + canvas player + speed toggle + console +
   plain save/open + auto-save (normal) + layout persistence (E).
4. **Exam subsystem**: session start/exit, input locks, CGEX1 dual-key
   save/decrypt, bundles, auto-save (exam), config file.
5. **Features**: error panel (3), autocomplete (4), pixel inspector (5),
   palette (7), grid (8), insert toolbar (9), filename convention (14).
6. **Packaging**: AppImage + `.tar.gz` (Linux), portable zip (Windows);
   air-gapped verification; run acceptance checklist (D).

## 11. Out of scope (do not build)

Proctoring (webcam/keystrokes/screen-capture blocking), backend/server,
accounts/rosters/cloud sync, autograding, macOS artifact, C++ beyond the
declared shim set (compile-time error by design), per-feature exam toggles
beyond grid/toolbar.

## 12. Open (non-blocking)

- `line()` signature from the course handout — winbgi standard assumed;
  one-line shim edit if the handout adds a color parameter.
- Offline emsdk bundling needs one verification iteration (hardcoded paths).
- Artifact size ~0.5 GB (Emscripten is the floor) — accepted for lab use.
