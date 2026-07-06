mod commands;
mod gitlab;
mod models;

use commands::{auth, storage, sync, updater};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            auth::save_token,
            auth::load_token,
            auth::delete_token,
            auth::validate_token,
            storage::load_config,
            storage::save_config,
            storage::load_state,
            storage::save_state,
            sync::list_projects,
            sync::fetch_issues,
            sync::fetch_branches,
            sync::fetch_wiki_page,
            sync::push_wiki_page,
            sync::list_wiki_pages,
            sync::open_url,
            sync::fetch_merge_requests,
            sync::fetch_milestones,
            updater::check_for_update,
            updater::app_version,
            updater::get_release_notes,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
