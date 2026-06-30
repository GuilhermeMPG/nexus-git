use crate::models::{AppConfig, AppState};
use std::path::PathBuf;

fn config_path() -> PathBuf {
    dirs::data_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("nexus-git")
        .join("config.json")
}

fn state_path() -> PathBuf {
    dirs::data_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("nexus-git")
        .join("state.json")
}

fn ensure_parent(path: &PathBuf) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    Ok(())
}

/// Writes via a temp file + rename so a crash mid-write never leaves a truncated/corrupted file.
fn write_atomic(path: &PathBuf, content: &str) -> Result<(), String> {
    ensure_parent(path).map_err(|e| e.to_string())?;
    let tmp_path = PathBuf::from(format!("{}.tmp", path.display()));
    std::fs::write(&tmp_path, content).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp_path, path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn load_config() -> Result<AppConfig, String> {
    let path = config_path();
    if !path.exists() {
        let default = AppConfig::default();
        save_config(default.clone())?;
        return Ok(default);
    }
    let content = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    serde_json::from_str(&content).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn save_config(config: AppConfig) -> Result<(), String> {
    let path = config_path();
    let json = serde_json::to_string_pretty(&config).map_err(|e| e.to_string())?;
    write_atomic(&path, &json)
}

#[tauri::command]
pub fn load_state() -> Result<AppState, String> {
    let path = state_path();
    if !path.exists() {
        return Ok(AppState::default());
    }
    let content = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    serde_json::from_str(&content).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn save_state(state: AppState) -> Result<(), String> {
    let path = state_path();
    let json = serde_json::to_string_pretty(&state).map_err(|e| e.to_string())?;
    write_atomic(&path, &json)
}
