// run-in-node.js — headless execution harness for compiled example programs.
//
// Spawns the compiled program in a real Node worker_threads Worker with the
// same bootstrap the app uses (ui/player.js), so the full pipeline — emcc
// output, the graphics shim, batching, delay pacing, fast mode, getch, and
// worker.terminate() as the Stop button — is exercised without a display.
//
// Usage: node test/run-in-node.js   (exit non-zero on any failure)

const { execFileSync } = require('child_process');
const { Worker } = require('worker_threads');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SHIM = path.join(ROOT, 'shim');
const EMSDK = process.env.CGD_EMSDK || path.join(ROOT, 'emsdk');
const EMCC = path.join(EMSDK, 'upstream/emscripten/emcc');
const SCRATCH = fs.mkdtempSync(path.join(os.tmpdir(), 'cgd-run-'));

const EMCC_FLAGS = [
  '-O1', '-sASYNCIFY', '-sMODULARIZE=1', '-sEXPORT_NAME=initModule',
  '-sENVIRONMENT=web,worker', '-sALLOW_MEMORY_GROWTH=1', '-sEXIT_RUNTIME=1',
  '-sINVOKE_RUN=0', '-sEXPORTED_RUNTIME_METHODS=callMain',
  '-sEXPORTED_FUNCTIONS=_main', '-sSTACK_SIZE=16777216',
];

// Worker bootstrap — same shape as ui/player.js (keep in sync).
const WORKER_BOOTSTRAP = `
let __mod = null;
self.addEventListener('message', function (e) {
  var d = e.data || {};
  if (d.type === 'start') {
    var wasmBytes = d.wasm;
    initModule({
      instantiateWasm: function (imports, cb) {
        WebAssembly.instantiate(wasmBytes, imports)
          .then(function (r) { cb(r.instance); })
          .catch(function (err) { postMessage({ type: 'abort', text: 'wasm init: ' + err }); });
        return {};
      },
      print: function (t) { postMessage({ type: 'stdout', text: t }); },
      printErr: function (t) { postMessage({ type: 'stderr', text: t }); },
      onExit: function (s) { postMessage({ type: 'exit', code: s }); },
      onAbort: function (what) { postMessage({ type: 'abort', text: String(what) }); },
      fast: !!d.fast
    }).then(function (m) {
      __mod = m;
      try { m.callMain(); } catch (err) {
        if (!err || err.status === undefined)
          postMessage({ type: 'abort', text: String((err && err.message) || err) });
      }
    }).catch(function (err) {
      postMessage({ type: 'abort', text: String((err && err.message) || err) });
    });
  } else if (d.type === 'fast') {
    if (__mod) __mod['fast'] = !!d.value;
  }
});
`;

// Node worker shims: parentPort as `self`, plus property-style onmessage
// dispatch (the graphics shim installs its key handler that way).
const NODE_WORKER_PRELUDE = `
const { parentPort } = require('worker_threads');
globalThis.self = globalThis;
var __listeners = [];
self.addEventListener = function (type, fn) { if (type === 'message') __listeners.push(fn); };
self.postMessage = function (m) { parentPort.postMessage(m); };
parentPort.on('message', function (data) {
  if (typeof globalThis.onmessage === 'function') globalThis.onmessage({ data: data });
  for (var i = 0; i < __listeners.length; i++) __listeners[i]({ data: data });
});
`;

function compile(files, name) {
  const dir = path.join(SCRATCH, name);
  fs.mkdirSync(dir, { recursive: true });
  const args = [];
  for (const [fname, src] of files) {
    fs.writeFileSync(path.join(dir, fname), src);
    args.push(path.join(dir, fname));
  }
  args.push(
    path.join(SHIM, 'graphics_shim.cpp'),
    ...EMCC_FLAGS,
    '--js-library', path.join(SHIM, 'graphics_lib.js'),
    '-I', SHIM,
    '-o', path.join(dir, 'out.js'),
  );
  execFileSync(EMCC, args, {
    env: { ...process.env, EMSDK, EM_CACHE: path.join(EMSDK, 'upstream/emscripten/cache') },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return {
    dir,
    jsPath: path.join(dir, 'out.js'),
    wasm: fs.readFileSync(path.join(dir, 'out.wasm')),
  };
}

// Start a program in a real worker thread and collect its messages.
// Returns { worker, messages, waitExit(ms), stop() }.
function runProgram({ jsPath, wasm }, { fast = false } = {}) {
  const workerFile = jsPath.replace(/out\.js$/, 'worker.js');
  fs.writeFileSync(workerFile, NODE_WORKER_PRELUDE + '\n' + WORKER_BOOTSTRAP + '\n' + fs.readFileSync(jsPath, 'utf8'));
  const messages = [];
  const worker = new Worker(workerFile);
  worker.on('message', (m) => messages.push(m));
  worker.postMessage({ type: 'start', wasm, fast }, [wasm.buffer]);
  const waitExit = (ms) => new Promise((resolve) => {
    const t0 = Date.now();
    const iv = setInterval(() => {
      const done = messages.some((m) => m.type === 'exit' || m.type === 'abort');
      if (done || Date.now() - t0 > ms) { clearInterval(iv); resolve(done); }
    }, 15);
  });
  const stop = () => new Promise((resolve) => {
    worker.terminate().then(() => resolve());
  });
  return { worker, messages, waitExit, stop };
}

const framesOf = (ms) => ms.filter((m) => m.type === 'frame');
const lastFrame = (ms) => framesOf(ms).at(-1);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- programs ---------------------------------------------------------------

const PROG_DELAY = `#include <graphics.h>
int main() {
    int gd = DETECT, gm;
    initgraph(&gd, &gm, "");
    for (int i = 0; i < 5; i++) {
        putpixel(10 + i, 10, RED);
        delay(120);
    }
    setcolor(GREEN);
    outtextxy(20, 40, "done");
    getch();
    closegraph();
    return 0;
}
`;

const PROG_250K = `#include <graphics.h>
int main() {
    int gd = DETECT, gm;
    initwindow(640, 480, "");
    for (int i = 0; i < 250000; i++) {
        putpixel(i % 640, (i / 640) % 480, i % 16);
    }
    closegraph();
    return 0;
}
`;

const PROG_GETCH = `#include <graphics.h>
int main() {
    int gd = DETECT, gm;
    initgraph(&gd, &gm, "");
    outtextxy(10, 10, "press");
    int c = getch();
    for (int i = 0; i < c; i++) putpixel(50 + i, 50, WHITE);
    closegraph();
    return 0;
}
`;

const PROG_INITWINDOW = `#include <graphics.h>
int main() {
    initwindow(320, 200, "custom");
    rectangle(0, 0, 319, 199);
    closegraph();
    return 0;
}
`;

const PROG_INFINITE = `#include <graphics.h>
int main() {
    int gd = DETECT, gm;
    initgraph(&gd, &gm, "");
    while (1) { putpixel(5, 5, WHITE); }
    return 0;
}
`;

// regression: a program with no delay() must still reach the player (the
// every-4000-calls flush rule from plan §4)
const PROG_NODELAY = `#include <graphics.h>
int main() {
    int gd = DETECT, gm;
    initgraph(&gd, &gm, "");
    for (int i = 0; i < 9000; i++) putpixel(i % 640, 100, CYAN);
    outtextxy(10, 200, "nodelay");
    closegraph();
    return 0;
}
`;

// ---- checks -----------------------------------------------------------------

let failed = 0;
function check(name, cond, detail) {
  console.log((cond ? 'PASS ' : 'FAIL ') + name + (cond ? '' : '  :: ' + (detail || '')));
  if (!cond) failed++;
}

async function runAll() {
  console.log('scratch:', SCRATCH);

  // 1. delay pacing: 5 x 120 ms honored in 1x, zero-length in fast; the
  // trailing getch() is ended by a key from the "player"
  const built = compile([['main.cpp', PROG_DELAY]], 'delay');
  {
    const r = runProgram({ ...built });
    const t0 = Date.now();
    // post the key once the drawing is done (frame with "done" text) or 10 s out
    const t0wait = Date.now();
    while (Date.now() - t0wait < 10000 &&
           !lastFrame(r.messages)?.texts?.some((t) => t.t === 'done')) await sleep(30);
    r.worker.postMessage({ type: 'key', key: 13 });
    await r.waitExit(15000);
    const elapsed1x = Date.now() - t0;
    check('delay program exits cleanly', r.messages.some((m) => m.type === 'exit'),
          JSON.stringify(r.messages.filter((m) => m.type === 'abort' || m.type === 'stderr')));
    check('frames were batched out (>=2 frames for 5 delays)', framesOf(r.messages).length >= 2,
          'frames=' + framesOf(r.messages).length);
    check('1x honors the waits (>=550 ms start to exit)', elapsed1x >= 550,
          'measured=' + elapsed1x + 'ms');
    const last = lastFrame(r.messages);
    check('putpixel(10..14,10) visible in last frame',
          last && last.rgba[4 * (10 * last.w + 14)] === 0xaa,
          JSON.stringify(last && { w: last.w, h: last.h }));
    check('text reaches the player (outtextxy)', last && last.texts.some((t) => t.t === 'done'),
          JSON.stringify(last && last.texts));
    await r.stop();
  }
  {
    // fresh wasm copy for this run: the first run's buffer was transferred
    const wasm2 = fs.readFileSync(path.join(built.dir, 'out.wasm'));
    const r = runProgram({ ...built, wasm: wasm2 }, { fast: true });
    const t0 = Date.now();
    const t0wait = Date.now();
    while (Date.now() - t0wait < 10000 &&
           !lastFrame(r.messages)?.texts?.some((t) => t.t === 'done')) await sleep(20);
    r.worker.postMessage({ type: 'key', key: 13 });
    await r.waitExit(15000);
    const elapsedFast = Date.now() - t0;
    check('fast mode zeroes the waits (<500 ms total)', elapsedFast < 500, elapsedFast + 'ms');
    check('fast mode still exits cleanly', r.messages.some((m) => m.type === 'exit'),
          JSON.stringify(r.messages.filter((m) => m.type === 'abort')));
    await r.stop();
  }

  // 2. 250k putpixel program finishes in seconds (acceptance D.6)
  {
    const big = compile([['main.cpp', PROG_250K]], 'big');
    const r = runProgram(big);
    const t0 = Date.now();
    await r.waitExit(120000);
    const bigMs = Date.now() - t0;
    check('250k putpixel program exits', r.messages.some((m) => m.type === 'exit'),
          JSON.stringify(r.messages.filter((m) => m.type === 'abort' || m.type === 'stderr')));
    check('250k putpixel renders in seconds (<30 s)', bigMs < 30000, bigMs + 'ms');
    const bigLast = lastFrame(r.messages);
    check('250k frame is 640x480 with painted pixels',
          bigLast && bigLast.w === 640 && bigLast.h === 480 &&
          bigLast.rgba[4 * (0 * 640 + 1)] === 0x00 && bigLast.rgba[4 * (0 * 640 + 1) + 2] === 0xaa,
          JSON.stringify(bigLast && { w: bigLast.w, h: bigLast.h }));
    await r.stop();
  }

  // 3. getch receives a key posted by the "player"
  {
    const g = compile([['main.cpp', PROG_GETCH]], 'getch');
    const r = runProgram(g);
    const t0 = Date.now();
    while (!framesOf(r.messages).length && Date.now() - t0 < 10000) await sleep(30);
    r.worker.postMessage({ type: 'key', key: 65 }); // 'A'
    await r.waitExit(15000);
    const gl = lastFrame(r.messages);
    check('getch wakes with the posted key (65 pixels drawn)',
          gl && gl.rgba[4 * (50 * gl.w + 114)] === 0xff,
          JSON.stringify(gl && { w: gl.w }));
    await r.stop();
  }

  // 4. initwindow(320,200) overrides the canvas size
  {
    const w = compile([['main.cpp', PROG_INITWINDOW]], 'win');
    const r = runProgram(w);
    await r.waitExit(15000);
    const cv = r.messages.find((m) => m.type === 'canvas');
    check('initwindow sets a 320x200 canvas', cv && cv.w === 320 && cv.h === 200, JSON.stringify(cv));
    await r.stop();
  }

  // 5. runaway while(1): frames keep streaming from the busy worker, and
  // terminate() (the Stop button) kills it while the main thread stays live
  {
    const inf = compile([['main.cpp', PROG_INFINITE]], 'inf');
    const r = runProgram(inf);
    await sleep(1500);
    check('runaway program streams frames from the busy worker', framesOf(r.messages).length > 0,
          'frames=' + framesOf(r.messages).length);
    check('runaway program has not exited (needs the Stop button)',
          !r.messages.some((m) => m.type === 'exit'));
    await r.stop();
    const alive = await new Promise((res) => { setTimeout(() => res('responsive'), 20); });
    check('main thread stays responsive after terminate()', alive === 'responsive');
  }

  // 5b. no-delay program: 4000-call batching rule delivers frames
  {
    const nd = compile([['main.cpp', PROG_NODELAY]], 'nd');
    const r = runProgram(nd);
    await r.waitExit(60000);
    const ndLast = lastFrame(r.messages);
    check('no-delay program still flushes frames to the player',
          ndLast && ndLast.texts.some((t) => t.t === 'nodelay'),
          'frames=' + framesOf(r.messages).length + ' texts=' + JSON.stringify(ndLast && ndLast.texts));
    await r.stop();
  }

  // 6. all bundled examples compile
  const exDir = path.join(ROOT, 'examples');
  for (const f of fs.readdirSync(exDir).sort()) {
    if (!f.endsWith('.cpp')) continue;
    try {
      compile([[f, fs.readFileSync(path.join(exDir, f), 'utf8')]], 'ex-' + f.replace(/\.cpp$/, ''));
      check('example compiles: ' + f, true);
    } catch (e) {
      check('example compiles: ' + f, false, String(e).slice(0, 400));
    }
  }

  return failed;
}

runAll().then((failed) => {
  console.log(failed ? `\n${failed} CHECK(S) FAILED` : '\nALL CHECKS PASSED');
  process.exit(failed ? 1 : 0);
});
