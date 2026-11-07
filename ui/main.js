// main.js — editor, tabs, toolbar wiring, compile/run flow, console, autosave.

const { invoke } = window.__TAURI__.core;

const NEW_TEMPLATE = `#include <graphics.h>

int main() {
    int gd = DETECT, gm;
    initgraph(&gd, &gm, "");

    setcolor(WHITE);
    outtextxy(100, 100, "Hello CG!");

    getch();
    closegraph();
    return 0;
}
`;

const ui = {
  log(text, cls) {
    const el = document.getElementById('console');
    const div = document.createElement('div');
    div.className = cls || 'out';
    div.textContent = text;
    el.appendChild(div);
    while (el.childNodes.length > 500) el.removeChild(el.firstChild);
    el.scrollTop = el.scrollHeight;
  },

  clearConsole() {
    document.getElementById('console').innerHTML = '';
  },

  status(s) {
    document.getElementById('status').textContent = s;
  },

  onRunState(running) {
    document.getElementById('btn-run').disabled = running;
    document.getElementById('btn-stop').disabled = !running;
    if (!running) this.status('stopped');
  },

  showErrors(text) {
    const el = document.getElementById('console');
    el.innerHTML = '';
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      const div = document.createElement('div');
      const m = line.match(/([\w.\-]+\.(?:cpp|c|h)):(\d+):(\d+)/);
      if (m) {
        div.className = 'err-line clickable';
        div.textContent = line;
        div.onclick = () => jumpTo(m[1], +m[2]);
      } else {
        div.className = line.includes('error:') ? 'err-line' : 'warn-line';
        div.textContent = line;
      }
      el.appendChild(div);
    }
    el.scrollTop = el.scrollHeight;
  },
};

// --- preference persistence (plan item E) ------------------------------------

const prefs = {
  load() {
    try { return JSON.parse(localStorage.getItem('cgdraw.prefs') || '{}'); }
    catch { return {}; }
  },
  save(p) {
    try { localStorage.setItem('cgdraw.prefs', JSON.stringify(p)); } catch {}
  },
};
let prefState = prefs.load();

// --- editor + tabs -----------------------------------------------------------

const editor = CodeMirror.fromTextArea(document.getElementById('editor'), {
  mode: 'text/x-c++src',
  lineNumbers: true,
  matchBrackets: true,
  indentUnit: 4,
  extraKeys: {
    'Ctrl-Space': 'autocomplete',
    'Cmd-Space': 'autocomplete',
  },
});

// Autocomplete (plan feature 4): suggest shim functions + constants.
editor.on('inputRead', (cm, change) => {
  if (!cm.state.completionActive && change.text[0] && /[A-Za-z_]/.test(change.text[0])) {
    cm.showHint({
      hint: cppHint,
      completeSingle: false,
      closeOnUnfocus: true,
    });
  }
});

function cppHint(cm) {
  const cur = cm.getCursor();
  const token = cm.getTokenAt(cur);
  const at = token.string.startsWith('.') ? token.start + 1 : token.start;
  const word = token.string.startsWith('.') ? token.string.slice(1) : token.string;
  const res = window.CG_API.complete(word);
  return {
    list: res.list,
    from: CodeMirror.Pos(cur.line, at),
    to: CodeMirror.Pos(cur.line, cur.ch),
  };
}

// Signature / description tooltip for a function call under the cursor.
let sigTipEl = null;
function tooltipAt(cm, pos) {
  const line = cm.getLine(pos.line);
  const tip = window.CG_API.callBefore(line, pos.ch);
  return tip ? { fn: tip.fn, col: tip.col } : null;
}
function hideSigTip() {
  if (sigTipEl) { sigTipEl.remove(); sigTipEl = null; }
}
editor.on('cursorActivity', () => {
  const pos = editor.getCursor();
  const tip = tooltipAt(editor, pos);
  hideSigTip();
  if (!tip) return;
  const coords = editor.charCoords(CodeMirror.Pos(pos.line, tip.col), 'local');
  sigTipEl = document.createElement('div');
  sigTipEl.className = 'cg-sig-tip';
  sigTipEl.textContent = tip.fn.sig + '   ' + tip.fn.desc;
  editor.getWrapperElement().appendChild(sigTipEl);
  sigTipEl.style.left = coords.left + 'px';
  sigTipEl.style.top = (coords.bottom + 6) + 'px';
});
editor.on('blur', hideSigTip);
editor.on('scroll', hideSigTip);

const tabs = []; // { name, doc, dirty }
let active = -1;

function renderTabs() {
  const el = document.getElementById('tabs');
  el.innerHTML = '';
  tabs.forEach((t, i) => {
    const span = document.createElement('span');
    span.className = 'tab' + (i === active ? ' active' : '') + (t.dirty ? ' dirty' : '');
    span.textContent = t.name;
    span.onclick = () => setActive(i);
    const close = document.createElement('span');
    close.className = 'close';
    close.textContent = '\u00d7';
    close.onclick = (e) => { e.stopPropagation(); closeTab(i); };
    span.appendChild(close);
    el.appendChild(span);
  });
}

function setActive(i) {
  active = i;
  editor.swapDoc(tabs[i].doc);
  editor.focus();
  renderTabs();
}

function closeTab(i) {
  tabs.splice(i, 1);
  if (!tabs.length) addTab(uniqueName('main'), NEW_TEMPLATE, false);
  setActive(Math.min(active >= tabs.length ? tabs.length - 1 : active, tabs.length - 1));
  renderTabs();
}

function uniqueName(base) {
  let name = base + '.cpp';
  for (let n = 2; tabs.some((t) => t.name === name); n++) name = base + n + '.cpp';
  return name;
}

function addTab(name, content, makeActive = true) {
  const existing = tabs.findIndex((t) => t.name === name);
  if (existing >= 0) {
    if (makeActive) setActive(existing);
    return;
  }
  tabs.push({ name, doc: CodeMirror.Doc(content, 'text/x-c++src'), dirty: false });
  if (makeActive) setActive(tabs.length - 1);
  renderTabs();
}

editor.on('change', () => {
  if (active >= 0 && !tabs[active].dirty) {
    tabs[active].dirty = true;
    renderTabs();
  }
});

function jumpTo(file, line) {
  const i = tabs.findIndex((t) => t.name === file);
  if (i < 0) return;
  setActive(i);
  editor.setCursor({ line: line - 1, ch: 0 });
  editor.scrollIntoView({ line: line - 1, ch: 0 }, 100);
  editor.focus();
}

// --- compile / run ------------------------------------------------------------

function b64bytes(b64) {
  const bin = atob(b64);
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u;
}

async function runActive() {
  if (!tabs.length) return;
  if (examEnded) return;
  player.stop();
  ui.clearConsole();
  ui.status('compiling\u2026');
  // plan §5: compile every tab in one em++ invocation
  const files = tabs.map((t) => [t.name, t.doc.getValue()]);
  try {
    const res = await invoke('compile', { files });
    if (res.errors && res.errors.trim()) ui.showErrors(res.errors);
    if (!res.ok) {
      ui.status('compile failed');
      return;
    }
    ui.status(res.cached ? 'running (cached build)' : 'running');
    const jsText = new TextDecoder().decode(b64bytes(res.js));
    player.start(jsText, b64bytes(res.wasm));
  } catch (e) {
    ui.log('compile error: ' + ((e && e.message) || e), 'err');
    ui.status('compile failed');
  }
}

// --- file actions ---------------------------------------------------------------

async function saveActive() {
  if (!tabs.length) return;
  if (examMode) return saveExam();
  const t = tabs[active];
  try {
    const path = await invoke('save_text', { defaultName: t.name, content: t.doc.getValue() });
    if (path) {
      t.dirty = false;
      renderTabs();
      ui.status('saved ' + path);
    }
  } catch (e) {
    ui.log('save failed: ' + ((e && e.message) || e), 'err');
  }
}

async function openFile() {
  if (examMode) return openExamSave();
  try {
    const files = await invoke('open_text');
    if (!files) return;
    for (const f of files) {
      if (f.exam_path) {
        // plan §7: reopen_allowed=false refuses student reopens
        await promptOpenExamFile(f);
      } else {
        addTab(f.name, f.content);
      }
    }
  } catch (e) {
    ui.log('open failed: ' + ((e && e.message) || e), 'err');
  }
}

// A CGEX1 file chosen in a multi-select open: prompt for the student
// passphrase and decrypt (8 h window + reopen_allowed enforced on the Rust side).
async function promptOpenExamFile(f) {
  modalForm(
    'Open encrypted save: ' + f.name,
    [{ key: 'pass', label: 'Passphrase', type: 'password' }],
    async (v) => {
      try {
        const files = await invoke('open_exam_if_allowed', {
          passphrase: v.pass.value,
          path: f.exam_path,
        });
        files.forEach(([name, content], i) => addTab(name, content, i === 0));
        ui.status(f.name + ' opened');
      } catch (e) {
        modalMessage('Open failed', (e && e.message) || String(e));
      }
    }
  );
}

// Save All (plan §5): every tab as its own plain file in one chosen folder.
async function saveAll() {
  if (examMode) return saveExam();
  try {
    const out = await invoke('save_all', { files: allFiles() });
    if (out) {
      tabs.forEach((t) => (t.dirty = false));
      renderTabs();
      await invoke('clear_autosaves');
      ui.status('saved ' + out.length + ' file(s)');
    }
  } catch (e) {
    modalMessage('Save all failed', (e && e.message) || String(e));
  }
}

async function autosaveAll() {
  if (examMode) {
    if (examEnded) return;
    try {
      await invoke('autosave_exam', { files: allFiles() });
    } catch (e) {
      ui.log('exam autosave failed: ' + ((e && e.message) || e), 'err');
    }
    return;
  }
  for (const t of tabs) {
    if (!t.dirty) continue;
    try {
      await invoke('autosave', { name: t.name, content: t.doc.getValue() });
    } catch (e) {
      ui.log('autosave failed: ' + ((e && e.message) || e), 'err');
      return;
    }
  }
}

// --- exam mode -------------------------------------------------------------------

let examMode = null;   // exam config while a session is active
let examEnded = false;

function allFiles() {
  return tabs.map((t) => [t.name, t.doc.getValue()]);
}

function blockEv(e) {
  e.preventDefault();
  e.stopPropagation();
}

function examKeyBlock(e) {
  if (!examMode) return;
  const k = (e.key || '').toLowerCase();
  if ((e.ctrlKey || e.metaKey) && (k === 'c' || k === 'v' || k === 'x')) {
    e.preventDefault();
    e.stopPropagation();
  }
}

function applyLockdown(on) {
  const ed = editor.getWrapperElement();
  if (on) {
    ed.addEventListener('copy', blockEv, true);
    ed.addEventListener('cut', blockEv, true);
    ed.addEventListener('paste', blockEv, true);
    document.addEventListener('contextmenu', blockEv, true);
    document.addEventListener('dragstart', blockEv, true);
    document.addEventListener('keydown', examKeyBlock, true);
  } else {
    ed.removeEventListener('copy', blockEv, true);
    ed.removeEventListener('cut', blockEv, true);
    ed.removeEventListener('paste', blockEv, true);
    document.removeEventListener('contextmenu', blockEv, true);
    document.removeEventListener('dragstart', blockEv, true);
    document.removeEventListener('keydown', examKeyBlock, true);
  }
}

function enterExamMode(cfg) {
  examMode = cfg;
  examEnded = false;
  document.body.classList.add('exam');
  document.getElementById('exam-banner').hidden = false;
  document.getElementById('exam-name').textContent = 'EXAM: ' + cfg.exam_name;
  const examBtn = document.getElementById('btn-exam'); // absent in release build
  if (examBtn) examBtn.disabled = true;
  document.getElementById('btn-open').textContent = 'Open save';
  // plan §7: no PNG export, no examples in exam mode
  document.getElementById('btn-png').disabled = true;
  document.getElementById('btn-examples').disabled = true;
  document.getElementById('btn-grid').disabled = true;
  document.getElementById('btn-save-all').disabled = true;
  applyLockdown(true);
  // filename convention (plan feature 14): seed a conventionally-named tab
  if (cfg.filename_convention && !tabs.some((t) => t.name === cfg.filename_convention)) {
    tabs.length = 0;
    addTab(cfg.filename_convention, (typeof cfg.starter === 'string' && cfg.starter) || NEW_TEMPLATE);
  }
  tickExam();
  examMode.timerIv = setInterval(tickExam, 1000);
}

function exitExamMode() {
  if (examMode && examMode.timerIv) clearInterval(examMode.timerIv);
  examMode = null;
  examEnded = false;
  document.body.classList.remove('exam');
  document.getElementById('exam-banner').hidden = true;
  const examBtn2 = document.getElementById('btn-exam'); // absent in release build
  if (examBtn2) examBtn2.disabled = false;
  document.getElementById('btn-open').textContent = 'Open';
  document.getElementById('btn-png').disabled = false;
  document.getElementById('btn-examples').disabled = false;
  document.getElementById('btn-grid').disabled = false;
  document.getElementById('btn-save-all').disabled = false;
  editor.setOption('readOnly', false);
  document.getElementById('btn-run').disabled = false;
  document.getElementById('btn-save').disabled = false;
  document.getElementById('btn-new').disabled = false;
  applyLockdown(false);
  applyGridVisibility();
  ui.status('normal mode');
}

function tickExam() {
  const end = examMode.started_at + examMode.duration_mins * 60;
  const left = Math.floor(end - Date.now() / 1000);
  const el = document.getElementById('exam-timer');
  if (left <= 0) {
    el.textContent = 'EXAM ENDED';
    examEnded = true;
    editor.setOption('readOnly', true);
    document.getElementById('btn-run').disabled = true;
    document.getElementById('btn-save').disabled = true;
    document.getElementById('btn-new').disabled = true;
    clearInterval(examMode.timerIv);
  } else {
    const h = Math.floor(left / 3600);
    const m = Math.floor((left % 3600) / 60);
    const s = left % 60;
    el.textContent = 'time left ' + h + ':' + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
  }
}

async function saveExam() {
  try {
    const path = await invoke('save_exam', { files: allFiles() });
    if (path) {
      tabs.forEach((t) => (t.dirty = false));
      renderTabs();
      ui.status('exam save written: ' + path);
    }
  } catch (e) {
    ui.log('exam save failed: ' + ((e && e.message) || e), 'err');
  }
}

async function openExamSave() {
  modalForm('Open exam save', [{ key: 'pass', label: 'Passphrase', type: 'password' }], async (v) => {
    try {
      const files = await invoke('open_exam', { passphrase: v.pass.value });
      if (files) {
        tabs.length = 0;
        files.forEach(([name, content], i) => addTab(name, content, i === 0));
        ui.status('exam save opened');
      }
    } catch (e) {
      modalMessage('Open failed', (e && e.message) || String(e));
    }
  });
}

async function startExamFlow() {
  modalForm(
    'Start exam',
    [
      { key: 'name', label: 'Exam name', value: 'Midterm' },
      { key: 'mins', label: 'Duration (minutes)', value: '360' },
      { key: 'pass', label: 'Student passphrase (fresh per exam, min 4 chars)', type: 'password' },
      { key: 'ipass', label: 'Instructor passphrase (for grading, min 4 chars)', type: 'password' },
    ],
    async (v) => {
      try {
        await invoke('start_exam', {
          examName: v.name.value || 'Exam',
          durationMins: parseInt(v.mins.value, 10) || 360,
          passphrase: v.pass.value,
          instructorPass: v.ipass.value,
        });
        const cfg = await invoke('exam_status');
        enterExamMode(cfg);
        applyGridVisibility();
        // restore any autosave from a previous run of this exam
        const files = await invoke('open_exam_autosave', { passphrase: v.pass.value });
        if (files) for (const [name, content] of files) addTab(name, content);
      } catch (e) {
        modalMessage('Exam start failed', (e && e.message) || String(e));
      }
    }
  );
}

// --- tiny modal (wry has no window.prompt/alert) ---------------------------------

function modalForm(title, fields, onOk, selectOptions) {
  const overlay = document.getElementById('modal');
  document.getElementById('modal-title').textContent = title;
  const body = document.getElementById('modal-body');
  body.innerHTML = '';
  const inputs = {};
  for (const f of fields) {
    const label = document.createElement('label');
    label.textContent = f.label;
    let input;
    if (selectOptions && f.key === fields[0].key) {
      input = document.createElement('select');
      for (const o of selectOptions) {
        const opt = document.createElement('option');
        opt.value = o;
        opt.textContent = o;
        input.appendChild(opt);
      }
    } else {
      input = document.createElement('input');
      input.type = f.type || 'text';
      input.value = f.value || '';
    }
    body.appendChild(label);
    body.appendChild(input);
    inputs[f.key] = input;
  }
  const actions = document.getElementById('modal-actions');
  actions.innerHTML = '';
  const ok = document.createElement('button');
  ok.textContent = 'OK';
  ok.onclick = () => {
    overlay.hidden = true;
    onOk(inputs);
  };
  const cancel = document.createElement('button');
  cancel.textContent = 'Cancel';
  cancel.onclick = () => (overlay.hidden = true);
  actions.appendChild(ok);
  actions.appendChild(cancel);
  overlay.hidden = false;
  if (fields.length) inputs[fields[0].key].focus();
}

function modalMessage(title, text) {
  const overlay = document.getElementById('modal');
  document.getElementById('modal-title').textContent = title;
  const body = document.getElementById('modal-body');
  body.innerHTML = '';
  const div = document.createElement('div');
  div.className = 'msg';
  div.textContent = text;
  body.appendChild(div);
  const actions = document.getElementById('modal-actions');
  actions.innerHTML = '';
  const ok = document.createElement('button');
  ok.textContent = 'OK';
  ok.onclick = () => (overlay.hidden = true);
  actions.appendChild(ok);
  overlay.hidden = false;
}

function applyGridVisibility() {
  const want = examMode ? examMode.grid === true : !!prefState.grid;
  if (player.grid !== want) player.toggleGrid();
  document.getElementById('btn-grid').classList.toggle('on', want);
}

async function exportPng() {
  const name = (activeTabName() || 'canvas').replace(/\.\w+$/, '') + '.png';
  try {
    const path = await invoke('save_png', { dataUrl: player.toPngDataUrl(), defaultName: name });
    if (path) ui.status('png exported: ' + path);
  } catch (e) {
    ui.log('png export failed: ' + ((e && e.message) || e), 'err');
  }
}

async function showExamples() {
  try {
    const ex = await invoke('list_examples');
    if (!ex.length) { ui.log('no examples bundled', 'err'); return; }
    modalForm(
      'Load example',
      [{ key: 'pick', label: 'Example file', value: ex[0].name }],
      (v) => {
        const hit = ex.find((e) => e.name === v.pick.value) || ex[0];
        addTab(hit.name, hit.content);
        ui.status('loaded ' + hit.name);
      },
      ex.map((e) => e.name)
    );
  } catch (e) {
    ui.log('examples failed: ' + ((e && e.message) || e), 'err');
  }
}

function activeTabName() {
  return active >= 0 && tabs[active] ? tabs[active].name : null;
}

// --- layout persistence (plan item E) ------------------------------------------

function applySplit(pct) {
  const left = document.getElementById('left');
  const right = document.getElementById('right');
  const p = Math.min(80, Math.max(20, pct));
  left.style.flexBasis = p + '%';
  right.style.flexBasis = (100 - p) + '%';
  prefState.split = p;
}

function initSplitter() {
  const sp = document.getElementById('splitter');
  let dragging = false;
  sp.addEventListener('mousedown', (e) => { dragging = true; e.preventDefault(); });
  window.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    const main = document.getElementById('main').getBoundingClientRect();
    applySplit(((e.clientX - main.left) / main.width) * 100);
  });
  window.addEventListener('mouseup', () => {
    if (!dragging) return;
    dragging = false;
    prefs.save(prefState);
  });
  if (prefState.split) applySplit(prefState.split);
}

// --- session recovery (plan §5) ------------------------------------------------

async function offerRecovery() {
  try {
    const saves = await invoke('list_autosaves');
    if (!saves.length) return;
    modalForm('Recover unsaved work?', [
      { key: 'what', label: `Found ${saves.length} autosaved file(s). Type "yes" to restore them`, value: '' },
    ], async (v) => {
      if (v.what.value.trim().toLowerCase() !== 'yes') return;
      for (const s of saves) addTab(s.name, s.content);
      await invoke('clear_autosaves');
      ui.status('recovered ' + saves.length + ' file(s)');
    });
  } catch (e) {
    ui.log('recovery: ' + ((e && e.message) || e), 'err');
  }
}

// --- startup self-check (plan item B) ------------------------------------------

async function runSelfCheck() {
  try {
    const r = await invoke('selfcheck');
    if (!r.shim) ui.log('self-check: graphics shim not found \u2014 Run will fail', 'err');
    if (!r.toolchain) ui.log('self-check: emscripten toolchain not found \u2014 Run will fail', 'err');
    if (r.shim && r.toolchain) ui.status('ready');
  } catch (e) {
    ui.log('self-check failed: ' + ((e && e.message) || e), 'err');
  }
}

// --- wiring -----------------------------------------------------------------------

document.getElementById('btn-run').onclick = runActive;
document.getElementById('btn-stop').onclick = () => player.stop();
document.getElementById('btn-speed').onclick = () => {
  document.getElementById('btn-speed').textContent = player.toggleFast() ? 'FAST' : '1\u00d7';
};
document.getElementById('btn-zoom').onclick = () => {
  document.getElementById('btn-zoom').textContent = player.cycleZoom();
  prefState.zoomMode = player.zoomMode;
  prefs.save(prefState);
};
document.getElementById('btn-grid').onclick = () => {
  const on = player.toggleGrid();
  document.getElementById('btn-grid').classList.toggle('on', on);
  if (!examMode) { prefState.grid = on; prefs.save(prefState); }
};
document.getElementById('btn-png').onclick = exportPng;
document.getElementById('btn-examples').onclick = showExamples;
document.getElementById('btn-new').onclick = () => {
  if (examMode) return;
  addTab(uniqueName('main'), NEW_TEMPLATE);
};
document.getElementById('btn-open').onclick = openFile;
document.getElementById('btn-save').onclick = saveActive;
document.getElementById('btn-save-all').onclick = saveAll;
// release build: the start button is hidden; wire it up only when present so a
// dev build (button re-added to index.html) still works.
{ const examBtn = document.getElementById('btn-exam'); if (examBtn) examBtn.onclick = startExamFlow; }

// Function-key shortcuts (plan §4): F9 = Run, F10 = speed toggle, F12 = Stop,
// plus F5 = Run. Work in both normal and exam mode — including while the
// CodeMirror editor (a hidden textarea) has focus. Ignored while a modal is
// open so typing into a form does not launch a program.
function appHotkeys(e) {
  if (!document.getElementById('modal').hidden) return;
  switch (e.key) {
    case 'F9':
    case 'F5':
      e.preventDefault();
      runActive();
      return;
    case 'F10':
      e.preventDefault();
      document.getElementById('btn-speed').click();
      return;
    case 'F12':
      e.preventDefault();
      player.stop();
      return;
  }
}
document.addEventListener('keydown', appHotkeys, true);
document.getElementById('btn-exam-end').onclick = () =>
  modalForm('End exam', [], async () => {
    try {
      await invoke('end_exam');
      exitExamMode();
    } catch (e) {
      ui.log('end exam failed: ' + ((e && e.message) || e), 'err');
    }
  });

async function initExam() {
  try {
    const cfg = await invoke('exam_status');
    if (cfg) {
      enterExamMode(cfg);
      const files = await invoke('open_exam_autosave', { passphrase: cfg.passphrase });
      if (files) {
        for (const [name, content] of files) addTab(name, content);
        ui.status('autosave restored');
      }
    }
  } catch (e) {
    ui.log('exam init: ' + ((e && e.message) || e), 'err');
  }
}

player.init();
initSplitter();
if (prefState.zoomMode) { player.zoomMode = prefState.zoomMode; player.applyZoom(); }
addTab('main.cpp', NEW_TEMPLATE);
runSelfCheck();
initExam().then(() => {
  applyGridVisibility();
  if (!examMode) offerRecovery();
});
setInterval(autosaveAll, 60000);
