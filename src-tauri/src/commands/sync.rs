use crate::gitlab::{GitLabBranch, GitLabClient, GitLabIssue, GitLabMilestone, GitLabMR, GitLabProject, GitLabWikiPage};

#[tauri::command]
pub async fn list_projects(
    base_url: String,
    token: String,
    accept_invalid_certs: bool,
) -> Result<Vec<GitLabProject>, String> {
    let client = GitLabClient::new(&base_url, &token, accept_invalid_certs)?;
    client.list_projects().await
}

#[tauri::command]
pub async fn fetch_issues(
    base_url: String,
    token: String,
    accept_invalid_certs: bool,
    project_path: String,
    assignee: Option<String>,
    labels: Option<Vec<String>>,
    state: Option<String>,
) -> Result<Vec<GitLabIssue>, String> {
    let client = GitLabClient::new(&base_url, &token, accept_invalid_certs)?;
    let label_list = labels.unwrap_or_default();
    let issue_state = state.as_deref().unwrap_or("opened");
    client.list_issues(&project_path, assignee.as_deref(), &label_list, issue_state).await
}

#[tauri::command]
pub async fn fetch_branches(
    base_url: String,
    token: String,
    accept_invalid_certs: bool,
    project_path: String,
) -> Result<Vec<GitLabBranch>, String> {
    let client = GitLabClient::new(&base_url, &token, accept_invalid_certs)?;
    client.list_branches(&project_path).await
}

#[tauri::command]
pub async fn fetch_wiki_page(
    base_url: String,
    token: String,
    accept_invalid_certs: bool,
    project_path: String,
    slug: String,
    title: Option<String>,
) -> Result<Option<String>, String> {
    let client = GitLabClient::new(&base_url, &token, accept_invalid_certs)?;
    client.fetch_wiki_page(&project_path, &slug, title.as_deref()).await
}

#[tauri::command]
pub async fn list_wiki_pages(
    base_url: String,
    token: String,
    accept_invalid_certs: bool,
    project_path: String,
) -> Result<Vec<GitLabWikiPage>, String> {
    let client = GitLabClient::new(&base_url, &token, accept_invalid_certs)?;
    client.list_wiki_pages(&project_path).await
}

#[tauri::command]
pub async fn fetch_milestones(
    base_url: String,
    token: String,
    accept_invalid_certs: bool,
    project_path: String,
) -> Result<Vec<GitLabMilestone>, String> {
    let client = GitLabClient::new(&base_url, &token, accept_invalid_certs)?;
    client.list_milestones(&project_path).await
}

#[tauri::command]
pub async fn fetch_merge_requests(
    base_url: String,
    token: String,
    accept_invalid_certs: bool,
    project_path: String,
    state: Option<String>,
) -> Result<Vec<GitLabMR>, String> {
    let client = GitLabClient::new(&base_url, &token, accept_invalid_certs)?;
    let mr_state = state.as_deref().unwrap_or("opened");
    client.list_merge_requests(&project_path, mr_state).await
}

#[tauri::command]
pub fn open_url(url: String) -> Result<(), String> {
    if !url.starts_with("http://") && !url.starts_with("https://") {
        return Err("invalid_url_scheme".to_string());
    }
    open::that(&url).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn push_wiki_page(
    base_url: String,
    token: String,
    accept_invalid_certs: bool,
    project_path: String,
    slug: String,
    title: String,
    content: String,
) -> Result<(), String> {
    let client = GitLabClient::new(&base_url, &token, accept_invalid_certs)?;
    client.push_wiki_page(&project_path, &slug, &title, &content).await
}
