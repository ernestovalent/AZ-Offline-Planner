/// Write `content` (UTF-8 text) to `path` on the local filesystem.
/// Called by the frontend after the native save-dialog returns a chosen path.
#[tauri::command]
fn save_csv(path: String, content: String) -> Result<(), String> {
    std::fs::write(&path, content.as_bytes()).map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![greet, save_csv])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

// Keep the original greet command so nothing else breaks.
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}
