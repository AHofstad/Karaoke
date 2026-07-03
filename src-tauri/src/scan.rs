//! Fast library walk: returns every .txt under a root with mtime + size in a
//! single IPC call, so the frontend can diff against its scan cache without
//! thousands of stat round-trips (7k-song libraries are normal).

use serde::Serialize;
use std::path::Path;
use std::time::UNIX_EPOCH;

#[derive(Serialize)]
pub struct TxtFileStat {
    pub path: String,
    #[serde(rename = "mtimeMs")]
    pub mtime_ms: f64,
    pub size: u64,
}

#[tauri::command]
pub fn scan_txt_files(root: String) -> Vec<TxtFileStat> {
    let mut out = Vec::new();
    walk(Path::new(&root), 0, &mut out);
    out
}

fn walk(dir: &Path, depth: usize, out: &mut Vec<TxtFileStat>) {
    if depth > 8 {
        return;
    }
    let Ok(read_dir) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in read_dir.flatten() {
        let path = entry.path();
        if path.is_dir() {
            walk(&path, depth + 1, out);
        } else if path
            .extension()
            .is_some_and(|ext| ext.eq_ignore_ascii_case("txt"))
        {
            if let Ok(md) = entry.metadata() {
                let mtime_ms = md
                    .modified()
                    .ok()
                    .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                    .map(|d| d.as_millis() as f64)
                    .unwrap_or(0.0);
                out.push(TxtFileStat {
                    path: path.to_string_lossy().into_owned(),
                    mtime_ms,
                    size: md.len(),
                });
            }
        }
    }
}
