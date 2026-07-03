mod remote;

use std::sync::{Arc, Mutex};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let state: remote::SharedState = Arc::new(Mutex::new(remote::RemoteState::default()));

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .manage(state.clone())
        .setup(move |app| {
            remote::start(app.handle().clone(), state);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            remote::set_library,
            remote::get_remote_info,
            remote::queue_snapshot,
            remote::queue_add_local,
            remote::queue_remove,
            remote::queue_clear,
            remote::queue_next,
            remote::playing_stopped,
            remote::set_progress,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
