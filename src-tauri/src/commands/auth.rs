use keyring::Entry;
use crate::gitlab::{GitLabClient, GitLabUser};

const SERVICE: &str = "nexus-git";
const ACCOUNT: &str = "gitlab-pat";

#[tauri::command]
pub fn save_token(token: String) -> Result<(), String> {
    let entry = Entry::new(SERVICE, ACCOUNT).map_err(|e| e.to_string())?;
    entry.set_password(&token).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn load_token() -> Result<Option<String>, String> {
    let entry = Entry::new(SERVICE, ACCOUNT).map_err(|e| e.to_string())?;
    match entry.get_password() {
        Ok(token) => Ok(Some(token)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub fn delete_token() -> Result<(), String> {
    let entry = Entry::new(SERVICE, ACCOUNT).map_err(|e| e.to_string())?;
    match entry.delete_credential() {
        Ok(_) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub async fn validate_token(
    base_url: String,
    token: String,
    accept_invalid_certs: bool,
) -> Result<GitLabUser, String> {
    let client = GitLabClient::new(&base_url, &token, accept_invalid_certs)?;
    client.get_user().await
}
