// player.js — owns the canvas and the program worker.
// The worker is a Blob combining WORKER_BOOTSTRAP with the compiled emscripten
// output. The bootstrap uses addEventListener (not onmessage) so it coexists
// with the graphics shim's own onmessage key handler installed by CGI.init().

const WORKER_BOOTSTRAP = `
let __mod = null;
self.addEventListener('message', function (e) {
  var d = e.data || {};
  if (d.type === 'start') {
    var wasmBytes = d.wasm;
    initModule({
      // this emscripten build has no wasmBinary option; use the hook
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
        // ExitStatus (err.status set) is a normal end of program
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

const player = {
  worker: null,
  canvas: null,
  ctx: null,
  fast: false,
  running: false,
  zoomMode: 0, // 0 = fit, 1 = 1:1, 2 = 2x
  grid: false,
  texts: [],   // cumulative text list, redrawn on every frame (putImageData wipes the canvas)
  lastFrame: null, // last ImageData, for grid redraw / inspector

  init() {
    this.canvas = document.getElementById('screen');
    this.ctx = this.canvas.getContext('2d');
    this.canvas.addEventListener('keydown', (e) => this.onKey(e));
    this.canvas.addEventListener('click', () => this.canvas.focus());
    this.canvas.addEventListener('mousemove', (e) => this.onHover(e));
    this.canvas.addEventListener('mouseleave', () => this.setReadout(null));
    window.addEventListener('resize', () => this.applyZoom());
    this.clearScreen();
  },

  start(jsText, wasmBytes) {
    this.stop();
    this.texts = [];
    this.lastFrame = null;
    this.clearScreen();
    const blob = new Blob([WORKER_BOOTSTRAP, jsText], { type: 'text/javascript' });
    const url = URL.createObjectURL(blob);
    this.worker = new Worker(url);
    URL.revokeObjectURL(url);
    this.worker.onmessage = (e) => this.handle(e.data);
    this.worker.onerror = (e) => this.handle({ type: 'abort', text: e.message || 'worker error' });
    this.running = true;
    // transfer the underlying buffer: the transfer list rejects typed-array views
    this.worker.postMessage({ type: 'start', wasm: wasmBytes, fast: this.fast }, [wasmBytes.buffer]);
    ui.onRunState(true);
  },

  stop() {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    if (this.running) {
      this.running = false;
      ui.onRunState(false);
    }
    // plan §4: Stop clears the canvas
    this.texts = [];
    this.lastFrame = null;
    this.clearScreen();
  },

  toggleFast() {
    this.fast = !this.fast;
    if (this.worker) this.worker.postMessage({ type: 'fast', value: this.fast });
    return this.fast;
  },

  clearScreen() {
    this.ctx.fillStyle = '#000';
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
  },

  // Grid + axes overlay (plan feature 8), drawn on top of the frame.
  drawGrid() {
    if (!this.grid) return;
    const ctx = this.ctx, w = this.canvas.width, h = this.canvas.height;
    ctx.save();
    ctx.strokeStyle = 'rgba(120,140,170,0.28)';
    ctx.lineWidth = 1;
    const step = 50;
    ctx.beginPath();
    for (let x = 0; x <= w; x += step) { ctx.moveTo(x + 0.5, 0); ctx.lineTo(x + 0.5, h); }
    for (let y = 0; y <= h; y += step) { ctx.moveTo(0, y + 0.5); ctx.lineTo(w, y + 0.5); }
    ctx.stroke();
    // axes
    ctx.strokeStyle = 'rgba(220,180,90,0.75)';
    ctx.beginPath();
    ctx.moveTo(0, 0.5); ctx.lineTo(w, 0.5);
    ctx.moveTo(0.5, 0); ctx.lineTo(0.5, h);
    ctx.stroke();
    ctx.restore();
  },

  toggleGrid() {
    this.grid = !this.grid;
    // repaint from the last frame so the toggle is immediate
    if (this.lastFrame) {
      this.ctx.putImageData(this.lastFrame, 0, 0);
      this.drawTexts();
    } else {
      this.clearScreen();
    }
    this.drawGrid();
    return this.grid;
  },

  // Pixel inspector (plan feature 5): hover -> x, y, color index/RGB.
  onHover(e) {
    const rect = this.canvas.getBoundingClientRect();
    const x = Math.floor((e.clientX - rect.left) * this.canvas.width / rect.width);
    const y = Math.floor((e.clientY - rect.top) * this.canvas.height / rect.height);
    if (x < 0 || y < 0 || x >= this.canvas.width || y >= this.canvas.height) {
      this.setReadout(null);
      return;
    }
    const d = this.ctx.getImageData(x, y, 1, 1).data;
    this.setReadout({ x, y, r: d[0], g: d[1], b: d[2] });
  },

  setReadout(p) {
    const el = document.getElementById('px-readout');
    if (!el) return;
    if (!p) { el.textContent = '\u2014'; return; }
    const hex = '#' + [p.r, p.g, p.b].map((v) => v.toString(16).padStart(2, '0')).join('');
    el.textContent = `x=${p.x} y=${p.y}  rgb(${p.r},${p.g},${p.b}) ${hex}`;
  },

  // PNG export (plan §5): the canvas including texts and grid.
  toPngDataUrl() {
    return this.canvas.toDataURL('image/png');
  },

  handle(m) {
    switch (m.type) {
      case 'canvas':
        this.canvas.width = m.w;
        this.canvas.height = m.h;
        this.applyZoom();
        this.clearScreen();
        break;
      case 'frame': {
        if (m.texts && m.texts.length) {
          this.texts = this.texts.concat(m.texts);
          if (this.texts.length > 2000) this.texts = this.texts.slice(-2000);
        }
        const img = new ImageData(m.rgba, m.w, m.h);
        this.lastFrame = img;
        this.ctx.putImageData(img, 0, 0);
        this.drawTexts();
        this.drawGrid();
        break;
      }
      case 'clear':
        this.texts = [];
        this.lastFrame = null;
        this.clearScreen();
        break;
      case 'stdout':
        ui.log(m.text, 'out');
        break;
      case 'stderr':
        ui.log(m.text, 'err');
        break;
      case 'exit':
        ui.log('program finished (exit ' + m.code + ')', 'sys');
        this.stop();
        break;
      case 'abort':
        ui.log('ABORT: ' + m.text, 'err');
        this.stop();
        break;
    }
  },

  drawTexts() {
    for (const t of this.texts) {
      this.ctx.fillStyle =
        'rgb(' + ((t.c >>> 16) & 255) + ',' + ((t.c >>> 8) & 255) + ',' + (t.c & 255) + ')';
      this.ctx.font = 8 * t.cs + 'px monospace';
      this.ctx.textAlign = ['left', 'center', 'right'][t.hj] || 'left';
      this.ctx.textBaseline = ['alphabetic', 'middle', 'top'][t.vj] || 'top';
      this.ctx.fillText(t.t, t.x, t.y);
    }
  },

  onKey(e) {
    if (!this.running || !this.worker) return;
    let key = null;
    if (e.key.length === 1) key = e.key.charCodeAt(0);
    else if (e.key === 'Enter') key = 13;
    else if (e.key === 'Escape') key = 27;
    else if (e.key === 'Backspace') key = 8;
    else if (e.key === 'Tab') key = 9;
    else if (e.key.startsWith('Arrow'))
      key = { ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40 }[e.key];
    if (key == null) return;
    e.preventDefault();
    this.worker.postMessage({ type: 'key', key });
  },

  applyZoom() {
    const wrap = document.getElementById('canvas-wrap');
    const w = this.canvas.width, h = this.canvas.height;
    let scale;
    if (this.zoomMode === 0)
      scale = Math.min((wrap.clientWidth - 24) / w, (wrap.clientHeight - 24) / h, 3);
    else if (this.zoomMode === 1) scale = 1;
    else scale = 2;
    this.canvas.style.width = Math.max(1, Math.floor(w * scale)) + 'px';
    this.canvas.style.height = Math.max(1, Math.floor(h * scale)) + 'px';
  },

  cycleZoom() {
    this.zoomMode = (this.zoomMode + 1) % 3;
    this.applyZoom();
    return ['fit', '1:1', '2\u00d7'][this.zoomMode];
  },
};
