use base64::Engine as _;
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::fs;
use std::path::PathBuf;
use std::process::Command;
use tauri::Manager;
use tauri_plugin_dialog::DialogExt;

mod exam;

// emcc flags for the student build (shim/graphics_lib.js depends on these:
// MODULARIZE/EXPORT_NAME for the blob worker, INVOKE_RUN=0 + callMain,
// ASYNCIFY for delay/getch, ENVIRONMENT worker).
const EMCC_FLAGS: &[&str] = &[
    "-O1",
    "-sASYNCIFY",
    "-sMODULARIZE=1",
    "-sEXPORT_NAME=initModule",
    "-sENVIRONMENT=web,worker",
    "-sALLOW_MEMORY_GROWTH=1",
    "-sEXIT_RUNTIME=1",
    "-sINVOKE_RUN=0",
    "-sEXPORTED_RUNTIME_METHODS=callMain",
    "-sEXPORTED_FUNCTIONS=_main",
    "-sSTACK_SIZE=16777216",
];
// Bump to invalidate every cached build when flags/shim change.
const FLAGS_VERSION: &str = "cgd1";

#[derive(Serialize)]
struct CompileResult {
    ok: bool,
    js: Option<String>,   // base64 of emscripten out.js
    wasm: Option<String>, // base64 of out.wasm
    errors: String,
    cached: bool,
}

#[derive(Serialize)]
struct OpenedFile {
    name: String,
    content: String,
    // Set only for CGEX1 entries opened via `open_text`: the frontend prompts
    // for the passphrase and calls open_exam_if_allowed with this path.
    #[serde(skip_serializing_if = "Option::is_none")]
    exam_path: Option<String>,
}

#[derive(Serialize)]
struct FileOut {
    name: String,
    path: String,
}

fn sha_hex(s: &str) -> String {
    let h = Sha256::digest(s.as_bytes());
    h.iter().map(|b| format!("{:02x}", b)).collect()
}

fn sanitize_name(name: &str) -> String {
    let base = name.rsplit(['/', '\\']).next().unwrap_or("");
    let cleaned: String = base
        .chars()
        .filter(|c| c.is_alphanumeric() || matches!(c, '.' | '_' | '-'))
        .collect();
    let cleaned = if cleaned.is_empty() { "main.cpp".into() } else { cleaned };
    if cleaned.ends_with(".cpp") || cleaned.ends_with(".c") || cleaned.ends_with(".txt") {
        cleaned
    } else {
        format!("{}.cpp", cleaned)
    }
}

// Walk up from the exe (dev: <root>/src-tauri/target/debug, test: deps/…) until
// we hit the directory that contains the shim — robust across cargo layouts.
fn project_root() -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    exe.ancestors()
        .skip(1)
        .find(|p| p.join("shim/graphics_shim.cpp").exists())
        .map(|p| p.to_path_buf())
}

fn toolchain_root() -> Option<PathBuf> {
    if let Ok(p) = std::env::var("CGD_EMSDK") {
        let p = PathBuf::from(p);
        if p.join("upstream/emscripten/emcc").exists() {
            return Some(p);
        }
    }
    for cand in [PathBuf::from("emsdk"), project_root()?.join("emsdk")] {
        if cand.join("upstream/emscripten/emcc").exists() {
            return Some(cand);
        }
    }
    None
}

fn shim_dir() -> Option<PathBuf> {
    if let Ok(p) = std::env::var("CGD_SHIM") {
        let p = PathBuf::from(p);
        if p.join("graphics_shim.cpp").exists() {
            return Some(p);
        }
    }
    for cand in [PathBuf::from("shim"), project_root()?.join("shim")] {
        if cand.join("graphics_shim.cpp").exists() {
            return Some(cand);
        }
    }
    None
}

#[tauri::command]
fn compile(app: tauri::AppHandle, files: Vec<(String, String)>) -> Result<CompileResult, String> {
    // Plan §5: all tabs -> one em++ invocation (temp dir per run). Names are
    // sanitized to basenames; only one file defines main(), the rest are units
    // linked in the same invocation.
    if files.is_empty() {
        return Err("no files to compile".into());
    }
    let named: Vec<(String, String)> = files
        .iter()
        .map(|(n, s)| (sanitize_name(n), s.clone()))
        .collect();
    let shim = shim_dir().ok_or_else(|| "graphics shim not found".to_string())?;
    // shim contents in the key: a shim edit invalidates stale cached builds
    let shim_sig = sha_hex(&format!(
        "{}|{}",
        fs::read_to_string(shim.join("graphics_shim.cpp")).unwrap_or_default(),
        fs::read_to_string(shim.join("graphics_lib.js")).unwrap_or_default(),
    ));
    // order-independent key over every file, so tab order does not bust cache
    let mut keyed = named.clone();
    keyed.sort();
    let src_sig: String = keyed.iter().map(|(n, s)| format!("{}={}\n", n, s)).collect();
    let hash = sha_hex(&format!("{}|{}|{}", FLAGS_VERSION, src_sig, shim_sig));
    let cache = app
        .path()
        .app_cache_dir()
        .map_err(|e| e.to_string())?
        .join("emcc")
        .join(&hash);
    let js_path = cache.join("out.js");
    let wasm_path = cache.join("out.wasm");

    let read_result = |cached: bool| -> Result<CompileResult, String> {
        Ok(CompileResult {
            ok: true,
            js: Some(base64::engine::general_purpose::STANDARD.encode(
                fs::read(&js_path).map_err(|e| e.to_string())?,
            )),
            wasm: Some(base64::engine::general_purpose::STANDARD.encode(
                fs::read(&wasm_path).map_err(|e| e.to_string())?,
            )),
            errors: String::new(),
            cached,
        })
    };
    if js_path.exists() && wasm_path.exists() {
        return read_result(true);
    }

    let emsdk = toolchain_root().ok_or_else(|| "emscripten toolchain not found".to_string())?;
    let emcc = emsdk.join("upstream/emscripten/emcc");

    fs::create_dir_all(&cache).map_err(|e| e.to_string())?;
    for (n, s) in &named {
        fs::write(cache.join(n), s).map_err(|e| e.to_string())?;
    }

    let mut cmd = Command::new(&emcc);
    for (n, _) in &named {
        cmd.arg(cache.join(n));
    }
    cmd.arg(shim.join("graphics_shim.cpp"))
        .args(EMCC_FLAGS)
        .arg("--js-library")
        .arg(shim.join("graphics_lib.js"))
        .arg("-I")
        .arg(&shim)
        .arg("-o")
        .arg(&js_path)
        .env("EMSDK", &emsdk)
        .env("EM_CACHE", emsdk.join("upstream/emscripten/cache"));
    // Pin the config to the bundled emsdk-embedded one when it exists, so a
    // direct binary launch (no run.sh) still uses the bundled toolchain paths.
    let bundled_config = emsdk.join(".emscripten");
    if bundled_config.exists() {
        cmd.env("EM_CONFIG", &bundled_config);
    }
    let node_bin = emsdk.join("node/bin");
    if node_bin.exists() {
        if let Ok(path) = std::env::var("PATH") {
            let mut paths = vec![node_bin];
            paths.extend(std::env::split_paths(&path));
            if let Ok(joined) = std::env::join_paths(&paths) {
                cmd.env("PATH", joined);
            }
        }
    }
    let out = cmd.output().map_err(|e| format!("failed to run emcc: {}", e))?;
    let errors = format!(
        "{}{}",
        String::from_utf8_lossy(&out.stdout),
        String::from_utf8_lossy(&out.stderr)
    );

    if !out.status.success() {
        // never cache failures; drop partial output so the next attempt recompiles
        let _ = fs::remove_file(&js_path);
        let _ = fs::remove_file(&wasm_path);
        return Ok(CompileResult { ok: false, js: None, wasm: None, errors, cached: false });
    }
    read_result(false)
}

#[tauri::command]
fn autosave(app: tauri::AppHandle, name: String, content: String) -> Result<String, String> {
    let dir = app.path().app_data_dir().unwrap_or_default().join("autosaves");
    autosave_to_dir(&dir, &name, &content)
}

// Core, testable without Tauri: one draft file per open tab (flat, sanitized
// basenames) + a session.json index so recovery restores every tab in order.
fn autosave_to_dir(dir: &PathBuf, name: &str, content: &str) -> Result<String, String> {
    fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let fname = sanitize_name(name);
    fs::write(dir.join(&fname), content).map_err(|e| e.to_string())?;
    let index_path = dir.join("session.json");
    let mut index: Vec<String> = fs::read_to_string(&index_path)
        .ok()
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or_default();
    if !index.contains(&fname) {
        index.push(fname.clone());
    }
    fs::write(&index_path, serde_json::to_vec(&index).unwrap()).map_err(|e| e.to_string())?;
    Ok(dir.join(&fname).to_string_lossy().into_owned())
}

#[tauri::command]
fn save_text(app: tauri::AppHandle, default_name: String, content: String) -> Result<Option<String>, String> {
    let path = app
        .dialog()
        .file()
        .add_filter("Source files", &["cpp", "c", "h", "txt"])
        .set_file_name(&sanitize_name(&default_name))
        .blocking_save_file();
    let Some(path) = path else { return Ok(None) };
    let path = path.into_path().map_err(|e| e.to_string())?;
    fs::write(&path, content).map_err(|e| e.to_string())?;
    Ok(Some(path.to_string_lossy().into_owned()))
}

// Save All (plan §5): each tab as its own plain .cpp/.txt in one folder.
#[tauri::command]
fn save_all(
    app: tauri::AppHandle,
    files: Vec<(String, String)>,
) -> Result<Option<Vec<FileOut>>, String> {
    let dir = app.dialog().file().blocking_pick_folder();
    let Some(dir) = dir else { return Ok(None) };
    let dir = dir.into_path().map_err(|e| e.to_string())?;
    write_all_to_dir(&dir, &files).map(Some)
}

// Core, testable: refuses to clobber directories or symlinked entries.
fn write_all_to_dir(dir: &PathBuf, files: &[(String, String)]) -> Result<Vec<FileOut>, String> {
    fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let mut seen = std::collections::HashSet::new();
    let mut out = Vec::new();
    for (name, src) in files {
        let fname = sanitize_name(name);
        if !seen.insert(fname.clone()) {
            return Err(format!("two tabs share the name {}", fname));
        }
        let dest = dir.join(&fname);
        if let Ok(md) = fs::symlink_metadata(&dest) {
            if md.is_symlink() || md.is_dir() {
                return Err(format!("refusing to overwrite {}", dest.display()));
            }
        }
        fs::write(&dest, src).map_err(|e| e.to_string())?;
        out.push(FileOut {
            name: fname,
            path: dest.to_string_lossy().into_owned(),
        });
    }
    Ok(out)
}

// Multi-select open (plan §5): several plain files at once. A CGEX1 file in
// the selection is returned with is_exam = true and the frontend prompts for
// its passphrase (open handles it after this).
#[tauri::command]
fn open_text(app: tauri::AppHandle) -> Result<Option<Vec<OpenedFile>>, String> {
    let paths = app
        .dialog()
        .file()
        .add_filter("Source and save files", &["cpp", "c", "h", "txt", "cgex1"])
        .blocking_pick_files();
    let Some(paths) = paths else { return Ok(None) };
    let mut out = Vec::new();
    for p in paths {
        let path = p.into_path().map_err(|e| e.to_string())?;
        let name = path
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_else(|| "main.cpp".into());
        if name.to_lowercase().ends_with(".cgex1") {
            out.push(OpenedFile {
                name,
                content: String::new(),
                exam_path: Some(path.to_string_lossy().into_owned()),
            });
            continue;
        }
        let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
        out.push(OpenedFile { name, content, exam_path: None });
    }
    Ok(if out.is_empty() { None } else { Some(out) })
}

// Remove all normal-mode session drafts (after a successful recovery, save-all,
// or explicit discard) so stale files do not resurface next launch.
#[tauri::command]
fn clear_autosaves(app: tauri::AppHandle) -> Result<(), String> {
    let dir = app.path().app_data_dir().unwrap_or_default().join("autosaves");
    let _ = fs::remove_dir_all(&dir);
    Ok(())
}

#[derive(Serialize)]
struct SelfCheck {
    shim: Option<String>,
    toolchain: Option<String>,
}

// Startup self-check: the two things Run needs. The webview is proven by running.
#[tauri::command]
fn selfcheck() -> SelfCheck {
    SelfCheck {
        shim: shim_dir().map(|p| p.display().to_string()),
        toolchain: toolchain_root().map(|p| p.display().to_string()),
    }
}

// Canvas PNG export: data URL in, file on disk out.
#[tauri::command]
fn save_png(
    app: tauri::AppHandle,
    data_url: String,
    default_name: String,
) -> Result<Option<String>, String> {
    let b64 = data_url.split(',').nth(1).ok_or("bad data URL")?;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(b64)
        .map_err(|e| e.to_string())?;
    let path = app
        .dialog()
        .file()
        .add_filter("PNG image", &["png"])
        .set_file_name(&default_name)
        .blocking_save_file();
    let Some(path) = path else { return Ok(None) };
    let path = path.into_path().map_err(|e| e.to_string())?;
    fs::write(&path, bytes).map_err(|e| e.to_string())?;
    Ok(Some(path.to_string_lossy().into_owned()))
}

// Exam config authored in normal mode and shipped next to the exam.
#[tauri::command]
fn save_exam_config(
    app: tauri::AppHandle,
    config: serde_json::Value,
) -> Result<Option<String>, String> {
    let path = app
        .dialog()
        .file()
        .add_filter("Exam config", &["json"])
        .set_file_name("exam-config.json")
        .blocking_save_file();
    let Some(path) = path else { return Ok(None) };
    let path = path.into_path().map_err(|e| e.to_string())?;
    let text = serde_json::to_string_pretty(&config).map_err(|e| e.to_string())?;
    fs::write(&path, text).map_err(|e| e.to_string())?;
    Ok(Some(path.to_string_lossy().into_owned()))
}

#[tauri::command]
fn open_exam_config(app: tauri::AppHandle) -> Result<Option<serde_json::Value>, String> {
    let path = app
        .dialog()
        .file()
        .add_filter("Exam config", &["json"])
        .blocking_pick_file();
    let Some(path) = path else { return Ok(None) };
    let path = path.into_path().map_err(|e| e.to_string())?;
    let bytes = fs::read(&path).map_err(|e| e.to_string())?;
    let cfg = serde_json::from_slice(&bytes).map_err(|_| "not a valid exam config file".to_string())?;
    Ok(Some(cfg))
}

// Loadable starter templates from the project's examples/ directory.
#[tauri::command]
fn list_examples() -> Result<Vec<OpenedFile>, String> {
    let dir = project_root()
        .ok_or_else(|| "project root not found".to_string())?
        .join("examples");
    let mut out = Vec::new();
    let entries = fs::read_dir(&dir).map_err(|e| e.to_string())?;
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("cpp") {
            continue;
        }
        let name = path
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default();
        if let Ok(content) = fs::read_to_string(&path) {
            out.push(OpenedFile { name, content, exam_path: None });
        }
    }
    out.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(out)
}

// Session recovery (plan §5): list and load the normal-mode autosaves so a
// relaunch can offer to restore unsaved work.
#[tauri::command]
fn list_autosaves(app: tauri::AppHandle) -> Result<Vec<OpenedFile>, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?.join("autosaves");
    Ok(list_autosaves_in(&dir))
}

// Reads the drafts in the order recorded by session.json (set by autosave_to_dir),
// so recovery restores tabs in their original order. Falls back to sorted order
// for drafts written before the index existed.
fn list_autosaves_in(dir: &std::path::Path) -> Vec<OpenedFile> {
    let order: Vec<String> = fs::read_to_string(dir.join("session.json"))
        .ok()
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or_default();
    let mut names = order;
    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.flatten() {
            let name = entry
                .path()
                .file_name()
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or_default();
            if name != "session.json" && !names.contains(&name) {
                names.push(name);
            }
        }
    }
    let mut out = Vec::new();
    for name in names {
        if let Ok(content) = fs::read_to_string(dir.join(&name)) {
            out.push(OpenedFile { name, content, exam_path: None });
        }
    }
    out
}

#[tauri::command]
fn load_autosave(app: tauri::AppHandle, name: String) -> Result<OpenedFile, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?.join("autosaves");
    let path = dir.join(sanitize_name(&name));
    let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    Ok(OpenedFile { name, content, exam_path: None })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            compile, autosave, save_text, save_all, open_text, selfcheck, save_png,
            save_exam_config, open_exam_config, list_examples, list_autosaves, load_autosave,
            clear_autosaves, start_exam, exam_status, end_exam, save_exam, autosave_exam,
            open_exam, open_exam_if_allowed, open_exam_autosave,
            open_exam_instructor, pick_cgex1_path
        ])
        .run(tauri::generate_context!())
        .expect("error while running cg-draw-app");
}

// --- exam mode ----------------------------------------------------------------

fn to_hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{:02x}", b)).collect()
}

fn from_hex(s: &str) -> Result<Vec<u8>, String> {
    if s.len() % 2 != 0 {
        return Err("bad hex".into());
    }
    (0..s.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&s[i..i + 2], 16).map_err(|_| "bad hex".to_string()))
        .collect()
}

fn exam_session(app: &tauri::AppHandle) -> Result<serde_json::Value, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let bytes = fs::read(dir.join("exam_config.json"))
        .map_err(|_| "no exam in progress".to_string())?;
    serde_json::from_slice(&bytes).map_err(|_| "corrupted exam config".to_string())
}

// Builds the stored exam-config value. Pure so it can be unit-tested; the
// lesson fields (from an authored exam config file) are optional.
fn build_exam_config(
    exam_name: &str,
    duration_mins: u64,
    passphrase: &str,
    session_key_hex: &str,
    instructor: &exam::InstructorWrap,
    started_at: u64,
    lesson: &serde_json::Value,
) -> serde_json::Value {
    serde_json::json!({
        "exam_name": exam_name,
        "duration_mins": duration_mins,
        "passphrase": passphrase,
        "session_key": session_key_hex,
        "salt_i": to_hex(&instructor.salt_i),
        "wrap_pass": to_hex(&instructor.wrap_pass),
        "started_at": started_at,
        "starter": lesson["starter"].clone(),
        "reopen_allowed": lesson["reopen_allowed"].clone(),
        "filename_convention": lesson["filename_convention"].clone(),
        "grid": lesson["grid"].clone(),
        "insert_toolbar": lesson["insert_toolbar"].clone(),
    })
}

// Starts an exam: stores the student passphrase + a fresh instructor session
// key (wrapped with the instructor passphrase) in the app data dir.
// `lesson` carries optional exam-config fields: starter, reopen_allowed,
// filename_convention, grid, insert_toolbar.
#[tauri::command]
fn start_exam(
    app: tauri::AppHandle,
    exam_name: String,
    duration_mins: u64,
    passphrase: String,
    instructor_pass: String,
    lesson: Option<serde_json::Value>,
) -> Result<(), String> {
    if passphrase.len() < 4 {
        return Err("student passphrase too short (min 4 chars)".into());
    }
    if instructor_pass.len() < 4 {
        return Err("instructor passphrase too short (min 4 chars)".into());
    }
    let instructor = exam::new_instructor_wrap(&instructor_pass);
    let l = lesson.unwrap_or_else(|| serde_json::json!({}));
    let cfg = build_exam_config(
        &exam_name,
        duration_mins,
        &passphrase,
        &to_hex(&instructor.session_key),
        &instructor,
        exam::now_secs(),
        &l,
    );
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    // a fresh exam invalidates any stale autosave from a previous one
    let _ = fs::remove_file(dir.join("exam_autosave.cgex1"));
    fs::write(dir.join("exam_config.json"), serde_json::to_vec(&cfg).unwrap())
        .map_err(|e| e.to_string())?;
    Ok(())
}

// Frontend polls this on startup to re-enter exam mode after an app restart.
#[tauri::command]
fn exam_status(app: tauri::AppHandle) -> Result<Option<serde_json::Value>, String> {
    exam_session(&app).map(Some).or(Ok(None))
}

#[tauri::command]
fn end_exam(app: tauri::AppHandle) -> Result<(), String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let _ = fs::remove_file(dir.join("exam_config.json"));
    let _ = fs::remove_file(dir.join("exam_autosave.cgex1"));
    Ok(())
}

fn session_wrap(cfg: &serde_json::Value) -> Result<exam::InstructorWrap, String> {
    let sk = from_hex(cfg["session_key"].as_str().ok_or("corrupted exam config")?)?
        .try_into()
        .map_err(|_| "corrupted exam config".to_string())?;
    Ok(exam::InstructorWrap {
        session_key: sk,
        salt_i: from_hex(cfg["salt_i"].as_str().ok_or("corrupted exam config")?)?,
        wrap_pass: from_hex(cfg["wrap_pass"].as_str().ok_or("corrupted exam config")?)?,
    })
}

#[tauri::command]
fn save_exam(app: tauri::AppHandle, files: Vec<(String, String)>) -> Result<Option<String>, String> {
    let cfg = exam_session(&app)?;
    let passphrase = cfg["passphrase"].as_str().ok_or("corrupted exam config")?;
    let instructor = session_wrap(&cfg)?;
    let exam_name = cfg["exam_name"].as_str().unwrap_or("exam");
    let data = exam::encrypt_exam(&files, passphrase, &instructor)?;
    let path = app
        .dialog()
        .file()
        .add_filter("Encrypted exam save", &["cgex1"])
        .set_file_name(&format!("{}.cgex1", exam_name))
        .blocking_save_file();
    let Some(path) = path else { return Ok(None) };
    let path = path.into_path().map_err(|e| e.to_string())?;
    fs::write(&path, data).map_err(|e| e.to_string())?;
    Ok(Some(path.to_string_lossy().into_owned()))
}

// Encrypted autosave for exam mode: fixed path, no dialog.
#[tauri::command]
fn autosave_exam(app: tauri::AppHandle, files: Vec<(String, String)>) -> Result<(), String> {
    let cfg = exam_session(&app)?;
    let passphrase = cfg["passphrase"].as_str().ok_or("corrupted exam config")?;
    let instructor = session_wrap(&cfg)?;
    let data = exam::encrypt_exam(&files, passphrase, &instructor)?;
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    fs::write(dir.join("exam_autosave.cgex1"), data).map_err(|e| e.to_string())
}

// Student reopen: passphrase required, 8 h window enforced; also callable when
// no session is running (normal mode "Open save" path via multi-select).
#[tauri::command]
fn open_exam(app: tauri::AppHandle, passphrase: String) -> Result<Option<Vec<(String, String)>>, String> {
    let path = app
        .dialog()
        .file()
        .add_filter("Encrypted exam save", &["cgex1"])
        .blocking_pick_file();
    let Some(path) = path else { return Ok(None) };
    let path = path.into_path().map_err(|e| e.to_string())?;
    let bytes = fs::read(&path).map_err(|e| e.to_string())?;
    exam::decrypt_exam(&bytes, &passphrase, None, exam::now_secs()).map(Some)
}

// reopen_allowed=false (exam config): refuses to reopen any encrypted save for
// a student once the exam has ended. Instructor decrypt ignores this flag.
#[tauri::command]
fn open_exam_if_allowed(app: tauri::AppHandle, passphrase: String, path: String) -> Result<Vec<(String, String)>, String> {
    let allowed = match exam_session(&app) {
        Ok(cfg) => cfg["reopen_allowed"] != false,
        Err(_) => true, // no session: normal mode, reopening an old save is fine
    };
    if !allowed {
        return Err("reopen is not allowed for this exam".into());
    }
    let bytes = fs::read(&path).map_err(|e| e.to_string())?;
    exam::decrypt_exam(&bytes, &passphrase, None, exam::now_secs())
}

// Restores the local encrypted autosave (e.g. after an app crash mid-exam).
#[tauri::command]
fn open_exam_autosave(app: tauri::AppHandle, passphrase: String) -> Result<Option<Vec<(String, String)>>, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let bytes = match fs::read(dir.join("exam_autosave.cgex1")) {
        Ok(b) => b,
        Err(_) => return Ok(None),
    };
    exam::decrypt_exam(&bytes, &passphrase, None, exam::now_secs()).map(Some)
}

// Instructor grading: instructor passphrase (never stored in the app or on
// disk), no 8 h window. The wrap inside the file recovers the session key.
#[tauri::command]
fn open_exam_instructor(passphrase: String, path: String) -> Result<Vec<(String, String)>, String> {
    let bytes = fs::read(&path).map_err(|e| e.to_string())?;
    exam::decrypt_exam(&bytes, "", Some(&passphrase), exam::now_secs())
}

// Path picker for the instructor flow (the dialog plugin has no vendored JS
// bindings, so the frontend goes through here).
#[tauri::command]
fn pick_cgex1_path(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let path = app
        .dialog()
        .file()
        .add_filter("Encrypted exam save", &["cgex1"])
        .blocking_pick_file();
    let Some(path) = path else { return Ok(None) };
    Ok(Some(path.into_path().map_err(|e| e.to_string())?.to_string_lossy().into_owned()))
}

// ---- acceptance D.1/D.6 helpers: compile through the real toolchain ----

#[cfg(test)]
mod compile_fixtures {
    // Two-TU sample used by the compile tests (main + second unit, like the
    // plan's multi-file requirement).
    pub const EXAMPLE_MAIN: &str = r#"#include <graphics.h>
int shape_color();
int main() {
    int gd = DETECT, gm;
    initgraph(&gd, &gm, "");
    setcolor(shape_color());
    circle(320, 240, 100);
    getch();
    return 0;
}
"#;
    pub const EXAMPLE_SHAPES: &str = r#"#include <graphics.h>
int shape_color() { return RED; }
"#;
}

#[cfg(test)]
mod compile_harness {
    use super::*;

    pub struct EmccOut {
        pub status: std::process::ExitStatus,
        pub stdout: Vec<u8>,
        pub stderr: Vec<u8>,
        pub js_path: PathBuf,
        pub wasm_path: PathBuf,
    }

    // The same invocation shape the `compile` command builds, extracted so
    // tests can drive the real toolchain without a Tauri AppHandle.
    pub fn emcc_run(emsdk: &PathBuf, shim: &PathBuf, files: &[(String, String)], scratch: &PathBuf) -> EmccOut {
        let _ = fs::remove_dir_all(scratch);
        fs::create_dir_all(scratch).unwrap();
        let mut cmd = Command::new(emsdk.join("upstream/emscripten/emcc"));
        for (name, src) in files {
            let p = scratch.join(sanitize_name(name));
            fs::write(&p, src).unwrap();
            cmd.arg(&p);
        }
        cmd.arg(shim.join("graphics_shim.cpp"))
            .args(EMCC_FLAGS)
            .arg("--js-library")
            .arg(shim.join("graphics_lib.js"))
            .arg("-I")
            .arg(shim)
            .arg("-o")
            .arg(scratch.join("out.js"))
            .env("EMSDK", emsdk)
            .env("EM_CACHE", emsdk.join("upstream/emscripten/cache"));
        let bundled_config = emsdk.join(".emscripten");
        if bundled_config.exists() {
            cmd.env("EM_CONFIG", &bundled_config);
        }
        let node_bin = emsdk.join("node/bin");
        if node_bin.exists() {
            if let Ok(path) = std::env::var("PATH") {
                let mut paths = vec![node_bin];
                paths.extend(std::env::split_paths(&path));
                if let Ok(joined) = std::env::join_paths(&paths) {
                    cmd.env("PATH", joined);
                }
            }
        }
        let out = cmd.output().expect("emcc must run");
        EmccOut {
            status: out.status,
            stdout: out.stdout,
            stderr: out.stderr,
            js_path: scratch.join("out.js"),
            wasm_path: scratch.join("out.wasm"),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shim_resolves_from_any_exe_layout() {
        let shim = shim_dir().expect("shim dir must resolve");
        assert!(shim.join("graphics_shim.cpp").exists(), "shim dir: {}", shim.display());
        assert!(toolchain_root().is_some(), "emsdk must resolve");
    }

    // The packaged run.sh sets CGD_EMSDK/CGD_SHIM so the app works from the
    // extracted archive regardless of the current directory.
    #[test]
    fn env_overrides_resolve_packaged_layout() {
        let root = project_root().expect("project root");
        std::env::set_var("CGD_SHIM", root.join("shim"));
        std::env::set_var("CGD_EMSDK", root.join("emsdk"));
        let shim = shim_dir().expect("CGD_SHIM must resolve");
        assert!(shim.join("graphics_shim.cpp").exists());
        let tc = toolchain_root().expect("CGD_EMSDK must resolve");
        assert!(tc.join("upstream/emscripten/emcc").exists());
        std::env::remove_var("CGD_SHIM");
        std::env::remove_var("CGD_EMSDK");
    }

    #[test]
    fn sanitize_rejects_paths() {
        assert_eq!(sanitize_name("../../etc/passwd"), "passwd.cpp");
        assert_eq!(sanitize_name("rollno_exam.cpp"), "rollno_exam.cpp");
        assert_eq!(sanitize_name("my file (1)"), "myfile1.cpp");
        assert_eq!(sanitize_name(""), "main.cpp");
        assert_eq!(sanitize_name("notes.txt"), "notes.txt");
    }

    #[test]
    fn hex_roundtrip() {
        let b: Vec<u8> = (0u8..32).collect();
        assert_eq!(from_hex(&to_hex(&b)).unwrap(), b);
        assert!(from_hex("xyz").is_err());
        assert!(from_hex("abc").is_err()); // odd length
    }

    // Feature 6: exam config file values flow into the stored session config.
    #[test]
    fn exam_config_consumes_lesson_fields() {
        let instructor = exam::new_instructor_wrap("grading");
        let lesson = serde_json::json!({
            "starter": "int main(){}",
            "reopen_allowed": false,
            "filename_convention": "roll_exam.cpp",
            "grid": true,
            "insert_toolbar": true,
        });
        let cfg = build_exam_config(
            "Midterm", 360, "pass", "deadbeef", &instructor, 1000, &lesson,
        );
        assert_eq!(cfg["exam_name"], "Midterm");
        assert_eq!(cfg["filename_convention"], "roll_exam.cpp");
        assert_eq!(cfg["grid"], true);
        assert_eq!(cfg["insert_toolbar"], true);
        assert_eq!(cfg["reopen_allowed"], false);
        assert_eq!(cfg["starter"], "int main(){}");
        assert!(cfg["session_key"].is_string());
        assert!(cfg["wrap_pass"].is_string());

        // no lesson -> fields are null (not present as garbage)
        let empty = build_exam_config(
            "Quiz", 60, "pass", "cafe", &instructor, 2000, &serde_json::json!({}),
        );
        assert!(empty["filename_convention"].is_null());
        assert!(empty["grid"].is_null());
    }

    // The frontend polls exam_status and expects these exact keys.
    #[test]
    fn exam_status_shape_is_stable() {
        let instructor = exam::new_instructor_wrap("p");
        let cfg = build_exam_config(
            "E", 120, "p", "aa", &instructor, 500, &serde_json::json!({}),
        );
        for key in ["exam_name", "duration_mins", "passphrase", "session_key", "salt_i",
                    "wrap_pass", "started_at"] {
            assert!(cfg.get(key).is_some(), "missing key: {}", key);
        }
        assert_eq!(cfg["duration_mins"], 120);
        assert_eq!(cfg["started_at"], 500);
    }

    // ---- acceptance D.3: CGEX1 E2E over the same helpers the commands use ----

    // start_exam -> autosave_exam -> (app restart) -> reopen within window.
    #[test]
    fn cgex1_exam_roundtrip_end_to_end() {
        let instructor = exam::new_instructor_wrap("grade-with-this");
        let cfg = build_exam_config(
            "Midterm", 360, "stud-pass", &to_hex(&instructor.session_key),
            &instructor, exam::now_secs(), &serde_json::json!({}),
        );
        let wrap = session_wrap(&cfg).expect("config must round-trip into a wrap");
        assert_eq!(wrap.session_key, instructor.session_key);

        let files = vec![
            ("rollno_exam.cpp".to_string(), "int main() { circle(1,2,3); }".to_string()),
            ("helper.cpp".to_string(), "int helper() { return 7; }".to_string()),
        ];
        let blob = exam::encrypt_exam(&files, "stud-pass", &wrap).unwrap();

        // student reopen, same passphrase, inside the 8 h window
        let got = exam::decrypt_exam(&blob, "stud-pass", None, exam::now_secs()).unwrap();
        assert_eq!(got, files);
        // wrong passphrase refuses
        assert!(exam::decrypt_exam(&blob, "nope", None, exam::now_secs()).is_err());
    }

    // Autosaves keep working after an app restart: the session key travels in
    // the exam config, and each save still carries the instructor wrap.
    #[test]
    fn cgex1_autosave_after_restart_then_instructor_decrypt() {
        let instructor = exam::new_instructor_wrap("teach-pass");
        let cfg = build_exam_config(
            "Final", 240, "s-pass", &to_hex(&instructor.session_key),
            &instructor, exam::now_secs(), &serde_json::json!({}),
        );
        let wrap = session_wrap(&cfg).unwrap();

        let files = vec![("rollno_exam.cpp".to_string(), "// final answer".to_string())];
        let autosave = exam::encrypt_exam(&files, "s-pass", &wrap).unwrap();
        // 3 days later: student path expired, instructor path still opens.
        let now = exam::now_secs() + 3 * 24 * 3600;
        assert!(exam::decrypt_exam(&autosave, "s-pass", None, now).is_err());
        let got = exam::decrypt_exam(&autosave, "", Some("teach-pass"), now).unwrap();
        assert_eq!(got, files);
    }

    // ---- normal-mode file tests (plan §5) --------------------------------

    #[test]
    fn autosave_roundtrip_keeps_tab_order() {
        let dir = std::env::temp_dir().join(format!("cgd-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        autosave_to_dir(&dir, "main.cpp", "int main(){}").unwrap();
        autosave_to_dir(&dir, "util.cpp", "int u() { return 1; }").unwrap();
        autosave_to_dir(&dir, "../evil.cpp", "nope").unwrap(); // sanitized
        let idx: Vec<String> =
            serde_json::from_str(&fs::read_to_string(dir.join("session.json")).unwrap()).unwrap();
        assert_eq!(idx, vec!["main.cpp", "util.cpp", "evil.cpp"]);
        assert_eq!(fs::read_to_string(dir.join("util.cpp")).unwrap(), "int u() { return 1; }");
        // re-saving an existing tab must not duplicate it in the index
        autosave_to_dir(&dir, "util.cpp", "updated").unwrap();
        let idx: Vec<String> =
            serde_json::from_str(&fs::read_to_string(dir.join("session.json")).unwrap()).unwrap();
        assert_eq!(idx.len(), 3);
        assert_eq!(fs::read_to_string(dir.join("util.cpp")).unwrap(), "updated");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn save_all_writes_plain_files_and_refuses_clobbers() {
        let dir = std::env::temp_dir().join(format!("cgd-saveall-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(dir.join("sub")).unwrap();
        let files = vec![
            ("main.cpp".to_string(), "int main(){}".to_string()),
            ("notes.txt".to_string(), "hello".to_string()),
        ];
        let out = write_all_to_dir(&dir, &files).unwrap();
        assert_eq!(out.len(), 2);
        assert!(out[0].path.ends_with("main.cpp"));
        assert_eq!(fs::read_to_string(dir.join("main.cpp")).unwrap(), "int main(){}");
        assert_eq!(fs::read_to_string(dir.join("notes.txt")).unwrap(), "hello");

        // a directory in the way is never overwritten (main.cpp IS a directory)
        fs::remove_file(dir.join("main.cpp")).unwrap();
        fs::create_dir_all(dir.join("main.cpp")).unwrap();
        let bad = vec![("main.cpp".to_string(), "x".to_string())];
        assert!(write_all_to_dir(&dir, &bad).is_err());
        // duplicate tab names refuse rather than silently overwrite
        let dup = vec![
            ("a.cpp".to_string(), "1".to_string()),
            ("a.cpp".to_string(), "2".to_string()),
        ];
        assert!(write_all_to_dir(&dir, &dup).is_err());
        let _ = fs::remove_dir_all(&dir);
    }

    // ---- acceptance D.1/D.6 helpers: compile through the real toolchain ----

    #[test]
    fn compile_multi_file_program_and_cache_hit() {
        let files = vec![
            ("main.cpp".to_string(), compile_fixtures::EXAMPLE_MAIN.to_string()),
            ("shapes.cpp".to_string(), compile_fixtures::EXAMPLE_SHAPES.to_string()),
        ];
        let shim = shim_dir().expect("shim");
        let emsdk = toolchain_root().expect("emsdk");
        let out = compile_harness::emcc_run(
            &emsdk, &shim, &files, &std::env::temp_dir().join("cgd-compile-test"),
        );
        assert!(out.status.success(), "emcc failed: {} {}",
                String::from_utf8_lossy(&out.stdout), String::from_utf8_lossy(&out.stderr));
        let js = std::fs::read(out.js_path).unwrap();
        let wasm = std::fs::read(out.wasm_path).unwrap();
        assert!(js.len() > 1000 && wasm.len() > 100);
        assert!(wasm.starts_with(b"\0asm"));
    }

    #[test]
    fn compile_error_reports_file_and_line() {
        let files = vec![(
            "main.cpp".to_string(),
            "#include <graphics.h>\nint main() { this does not compile }".to_string(),
        )];
        let shim = shim_dir().expect("shim");
        let emsdk = toolchain_root().expect("emsdk");
        let out = compile_harness::emcc_run(
            &emsdk, &shim, &files, &std::env::temp_dir().join("cgd-compile-bad"),
        );
        assert!(!out.status.success());
        let text = format!(
            "{}{}",
            String::from_utf8_lossy(&out.stdout),
            String::from_utf8_lossy(&out.stderr)
        );
        assert!(text.contains("main.cpp"), "error must name the file: {}", text);
        assert!(text.contains(":2:"), "error must carry a line number: {}", text);
    }
}
