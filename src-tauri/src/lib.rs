mod files;
mod moves;
mod updates;
mod zipio;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[allow(unused_mut)]
    let mut builder = tauri::Builder::default();
    // Registered first, as the plugin requires. A second start (e.g. while an update installs)
    // only brings the running window forward instead of opening another one.
    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            use tauri::Manager;
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }));
    }
    builder
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            files::data_load,
            files::data_save,
            files::data_file_path,
            files::default_invoice_dir,
            files::write_invoice,
            files::list_dir,
            files::read_text,
            files::trash_paths,
            files::delete_paths,
            moves::move_invoices,
            zipio::export_zip,
            zipio::zip_list,
            zipio::zip_extract,
            updates::update_pending,
            updates::update_install_pending,
            updates::update_download,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
