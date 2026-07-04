//! Loudness store: measured LUFS values per song, persisted to a small
//! loudness.json in the app data dir.
//!
//! Persistence lives in Rust because JS-side chained fs-plugin writes proved
//! unreliable during startup (invoke responses can get lost while the webview
//! is saturated loading covers). `save_loudness` is called fire-and-forget
//! from the frontend: the write happens here even if the response is dropped.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Mutex;
use tauri::Manager;

#[derive(Clone, Serialize, Deserialize)]
pub struct Loudness {
    pub lufs: f64,
    pub tp: f64,
}

#[derive(Default)]
pub struct LoudnessStore(Mutex<Option<HashMap<String, Loudness>>>);

const FILE: &str = "loudness.json";

fn file_path(app: &tauri::AppHandle) -> Option<std::path::PathBuf> {
    app.path().app_data_dir().ok().map(|d| d.join(FILE))
}

fn load_from_disk(app: &tauri::AppHandle) -> HashMap<String, Loudness> {
    file_path(app)
        .and_then(|p| std::fs::read_to_string(p).ok())
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_default()
}

#[tauri::command]
pub fn load_loudness(
    app: tauri::AppHandle,
    store: tauri::State<'_, LoudnessStore>,
) -> HashMap<String, Loudness> {
    let mut guard = store.0.lock().unwrap();
    guard.get_or_insert_with(|| load_from_disk(&app)).clone()
}

#[tauri::command]
pub fn save_loudness(
    app: tauri::AppHandle,
    store: tauri::State<'_, LoudnessStore>,
    txt_path: String,
    lufs: f64,
    tp: f64,
) {
    let mut guard = store.0.lock().unwrap();
    let map = guard.get_or_insert_with(|| load_from_disk(&app));
    map.insert(txt_path, Loudness { lufs, tp });
    if let Some(p) = file_path(&app) {
        if let Some(dir) = p.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        if let Ok(json) = serde_json::to_string(&*map) {
            if let Err(e) = std::fs::write(&p, json) {
                eprintln!("loudness: could not write {}: {e}", p.display());
            }
        }
    }
}
