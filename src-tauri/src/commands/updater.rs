use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::time::Duration;

#[derive(Debug, Deserialize)]
struct GitHubRelease {
    tag_name: String,
    html_url: String,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub current_version: String,
    pub latest_version: String,
    pub update_available: bool,
    pub release_url: String,
}

/// Parses "v1.2.3" or "1.2.3" into a comparable tuple. Malformed tags sort as (0,0,0) so a
/// bad release name never falsely triggers (or blocks) an update notice.
fn parse_semver(tag: &str) -> Option<(u64, u64, u64)> {
    let trimmed = tag.trim_start_matches('v');
    let mut parts = trimmed.split('.');
    let major = parts.next()?.parse().ok()?;
    let minor = parts.next()?.parse().ok()?;
    let patch = parts.next()?.parse().ok()?;
    Some((major, minor, patch))
}

/// Checks the "latest" release of a public GitHub repo (`owner/name`) against the version this
/// binary was built with. Read-only, unauthenticated (GitHub's public API rate limit is 60
/// req/hour/IP, far more than a periodic check needs) — no token required or stored.
#[tauri::command]
pub async fn check_for_update(repo: String) -> Result<UpdateInfo, String> {
    let current_version = env!("CARGO_PKG_VERSION").to_string();

    let client = Client::builder()
        .timeout(Duration::from_secs(15))
        .user_agent("nexus-git-updater")
        .build()
        .map_err(|e| e.to_string())?;

    let url = format!("https://api.github.com/repos/{repo}/releases/latest");
    let resp = client
        .get(&url)
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
        .map_err(|e| {
            if e.is_timeout() || e.is_connect() {
                format!("network_error:{e}")
            } else {
                e.to_string()
            }
        })?;

    if !resp.status().is_success() {
        return Err(format!("http_error:{}", resp.status().as_u16()));
    }

    let release: GitHubRelease = resp.json().await.map_err(|e| e.to_string())?;

    let current = parse_semver(&current_version).unwrap_or((0, 0, 0));
    let latest = parse_semver(&release.tag_name).unwrap_or((0, 0, 0));

    Ok(UpdateInfo {
        current_version,
        latest_version: release.tag_name,
        update_available: latest > current,
        release_url: release.html_url,
    })
}
