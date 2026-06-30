use reqwest::{Client, Response};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::time::Duration;

#[derive(Debug, Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GitLabUser {
    pub id: u64,
    pub username: String,
    pub name: String,
    #[serde(rename = "avatar_url")]
    pub avatar_url: Option<String>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct GitLabIssueMilestone {
    pub title: String,
    #[serde(rename = "due_date")]
    pub due_date: Option<String>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct GitLabIssue {
    pub id: u64,
    pub iid: u64,
    pub title: String,
    pub state: String,
    #[serde(rename = "web_url")]
    pub web_url: String,
    pub assignee: Option<GitLabAssignee>,
    pub labels: Vec<String>,
    pub milestone: Option<GitLabIssueMilestone>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct GitLabAssignee {
    pub username: String,
    pub name: String,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct GitLabBranch {
    pub name: String,
    pub merged: bool,
    #[serde(rename = "web_url")]
    pub web_url: String,
    pub commit: Option<GitLabCommit>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct GitLabCommit {
    pub committed_date: Option<String>,
    pub author_name: Option<String>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct GitLabProject {
    pub id: u64,
    pub name: String,
    #[serde(rename = "path_with_namespace")]
    pub path_with_namespace: String,
    #[serde(rename = "web_url")]
    pub web_url: String,
    pub description: Option<String>,
    pub namespace: GitLabNamespace,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct GitLabNamespace {
    pub name: String,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct GitLabWikiPage {
    #[serde(default)]
    pub content: String,
    pub slug: String,
    pub title: String,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct GitLabMR {
    pub iid: u64,
    pub title: String,
    pub state: String,
    pub draft: bool,
    #[serde(rename = "source_branch")]
    pub source_branch: String,
    #[serde(rename = "web_url")]
    pub web_url: String,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct GitLabMilestone {
    pub id: u64,
    pub iid: u64,
    pub title: String,
    pub state: String, // "active" | "closed"
    #[serde(rename = "due_date")]
    pub due_date: Option<String>,
}

pub struct GitLabClient {
    client: Client,
    base_url: String,
    token: String,
}

impl GitLabClient {
    pub fn new(base_url: &str, token: &str, accept_invalid_certs: bool) -> Result<Self, String> {
        let client = Client::builder()
            .timeout(Duration::from_secs(30))
            .danger_accept_invalid_certs(accept_invalid_certs)
            .build()
            .map_err(|e| e.to_string())?;
        Ok(Self {
            client,
            base_url: base_url.trim_end_matches('/').to_string(),
            token: token.to_string(),
        })
    }

    fn encode_path(path: &str) -> String {
        path.replace('/', "%2F")
    }

    /// Tags transient network failures (timeout/connection refused) with a `network_error:`
    /// prefix so the frontend can distinguish them from application errors and retry safely.
    fn map_send_err(e: reqwest::Error) -> String {
        if e.is_timeout() || e.is_connect() {
            format!("network_error:{e}")
        } else {
            e.to_string()
        }
    }

    async fn check_status(resp: Response) -> Result<Response, String> {
        match resp.status().as_u16() {
            200..=299 => Ok(resp),
            401 => Err("unauthorized".to_string()),
            403 => Err("forbidden".to_string()),
            404 => Err("not_found".to_string()),
            s   => Err(format!("http_error:{s}")),
        }
    }

    pub async fn get_user(&self) -> Result<GitLabUser, String> {
        let resp = self.client
            .get(format!("{}/api/v4/user", self.base_url))
            .header("PRIVATE-TOKEN", &self.token)
            .send().await.map_err(Self::map_send_err)?;
        Self::check_status(resp).await?
            .json::<GitLabUser>().await.map_err(|e| e.to_string())
    }

    /// Fetch one page of issues for a specific label (or no label filter).
    async fn fetch_issues_page(
        &self,
        encoded_path: &str,
        assignee: Option<&str>,
        label: Option<&str>,
        state: &str,
        page: u32,
    ) -> Result<(Vec<GitLabIssue>, Option<u32>), String> {
        let mut url = format!(
            "{}/api/v4/projects/{}/issues?state={}&per_page=100&page={}&order_by=updated_at&sort=desc",
            self.base_url, encoded_path, state, page
        );
        if let Some(a) = assignee {
            if !a.is_empty() {
                url.push_str(&format!("&assignee_username={}", a));
            }
        }
        if let Some(l) = label {
            url.push_str(&format!("&labels={}", urlencoding::encode(l)));
        }

        let resp = self.client.get(&url)
            .header("PRIVATE-TOKEN", &self.token)
            .send().await.map_err(Self::map_send_err)?;

        let next_page = resp.headers()
            .get("x-next-page")
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.parse::<u32>().ok());

        let resp = Self::check_status(resp).await?;
        let items: Vec<GitLabIssue> = resp.json().await.map_err(|e| e.to_string())?;
        Ok((items, next_page))
    }

    /// Fetch all issues matching one optional label (paginated).
    async fn fetch_all_for_label(
        &self,
        encoded_path: &str,
        assignee: Option<&str>,
        label: Option<&str>,
        state: &str,
        seen: &mut HashSet<u64>,
        out: &mut Vec<GitLabIssue>,
    ) -> Result<(), String> {
        let mut page = 1u32;
        loop {
            let (items, next) = self.fetch_issues_page(encoded_path, assignee, label, state, page).await?;
            for item in items {
                if seen.insert(item.id) {
                    out.push(item);
                }
            }
            match next {
                Some(n) => page = n,
                None => break,
            }
        }
        Ok(())
    }

    /// `state`: "opened" | "closed" | "all"  (default should be "opened")
    pub async fn list_issues(
        &self,
        project_path: &str,
        assignee: Option<&str>,
        labels: &[String],
        state: &str,
    ) -> Result<Vec<GitLabIssue>, String> {
        let encoded = Self::encode_path(project_path);
        let mut all = Vec::new();
        let mut seen: HashSet<u64> = HashSet::new();

        if labels.is_empty() {
            self.fetch_all_for_label(&encoded, assignee, None, state, &mut seen, &mut all).await?;
        } else {
            for label in labels {
                self.fetch_all_for_label(&encoded, assignee, Some(label.as_str()), state, &mut seen, &mut all).await?;
            }
        }
        Ok(all)
    }

    pub async fn list_projects(&self) -> Result<Vec<GitLabProject>, String> {
        let mut all = Vec::new();
        let mut page = 1u32;
        loop {
            let url = format!(
                "{}/api/v4/projects?membership=true&per_page=100&page={}&order_by=last_activity_at&simple=true",
                self.base_url, page
            );
            let resp = self.client.get(&url)
                .header("PRIVATE-TOKEN", &self.token)
                .send().await.map_err(Self::map_send_err)?;
            let next_page = resp.headers()
                .get("x-next-page")
                .and_then(|v| v.to_str().ok())
                .and_then(|v| v.parse::<u32>().ok());
            let resp = Self::check_status(resp).await?;
            let items: Vec<GitLabProject> = resp.json().await.map_err(|e| e.to_string())?;
            let done = items.is_empty() || next_page.is_none();
            all.extend(items);
            if done { break; }
            page = next_page.unwrap();
        }
        Ok(all)
    }

    /// List all wiki pages for a project (slug + title only, no content).
    pub async fn list_wiki_pages(&self, project_path: &str) -> Result<Vec<GitLabWikiPage>, String> {
        let encoded = Self::encode_path(project_path);
        let url = format!("{}/api/v4/projects/{}/wikis", self.base_url, encoded);
        let resp = self.client.get(&url)
            .header("PRIVATE-TOKEN", &self.token)
            .send().await.map_err(Self::map_send_err)?;
        let resp = Self::check_status(resp).await?;
        resp.json::<Vec<GitLabWikiPage>>().await.map_err(|e| e.to_string())
    }

    pub async fn list_branches(
        &self,
        project_path: &str,
    ) -> Result<Vec<GitLabBranch>, String> {
        let encoded = Self::encode_path(project_path);
        let mut all = Vec::new();
        let mut page = 1u32;
        loop {
            let url = format!(
                "{}/api/v4/projects/{}/repository/branches?per_page=100&page={}",
                self.base_url, encoded, page
            );
            let resp = self.client.get(&url)
                .header("PRIVATE-TOKEN", &self.token)
                .send().await.map_err(Self::map_send_err)?;
            let next_page = resp.headers()
                .get("x-next-page")
                .and_then(|v| v.to_str().ok())
                .and_then(|v| v.parse::<u32>().ok());
            let resp = Self::check_status(resp).await?;
            let items: Vec<GitLabBranch> = resp.json().await.map_err(|e| e.to_string())?;
            all.extend(items);
            match next_page {
                Some(n) => page = n,
                None => break,
            }
        }
        // Sort by commit date descending (most recent first)
        all.sort_by(|a, b| {
            let da = a.commit.as_ref().and_then(|c| c.committed_date.as_deref()).unwrap_or("");
            let db = b.commit.as_ref().and_then(|c| c.committed_date.as_deref()).unwrap_or("");
            db.cmp(da)
        });
        Ok(all)
    }

    /// Find the real slug of a wiki page, handling GitLab auto-slug generation.
    /// Matches by exact slug first, then by case-insensitive slug or title in listing.
    /// Returns None if no page found.
    async fn find_wiki_slug(
        &self,
        encoded_path: &str,
        slug: &str,
        title: Option<&str>,
    ) -> Result<Option<String>, String> {
        // 1. Try exact slug
        let url = format!(
            "{}/api/v4/projects/{}/wikis/{}",
            self.base_url, encoded_path, urlencoding::encode(slug)
        );
        let resp = self.client.get(&url)
            .header("PRIVATE-TOKEN", &self.token)
            .send().await.map_err(Self::map_send_err)?;

        match resp.status().as_u16() {
            200..=299 => return Ok(Some(slug.to_string())),
            404 => {} // continue to listing
            _ => { Self::check_status(resp).await?; return Ok(None); }
        }

        // 2. List all pages (slug + title only, no content needed here)
        let list_url = format!("{}/api/v4/projects/{}/wikis", self.base_url, encoded_path);
        let list_resp = self.client.get(&list_url)
            .header("PRIVATE-TOKEN", &self.token)
            .send().await.map_err(Self::map_send_err)?;

        match list_resp.status().as_u16() {
            404 | 403 => return Ok(None),
            _ => {}
        }
        let list_resp = Self::check_status(list_resp).await?;
        let pages: Vec<GitLabWikiPage> = list_resp.json().await.map_err(|e| e.to_string())?;

        let slug_lower = slug.to_lowercase();
        let title_lower = title.map(|t| t.to_lowercase());

        Ok(pages.iter().find(|p| {
            p.slug.to_lowercase() == slug_lower
                || title_lower.as_deref()
                    .map(|t| p.title.to_lowercase() == t)
                    .unwrap_or(false)
        }).map(|p| p.slug.clone()))
    }

    pub async fn list_milestones(
        &self,
        project_path: &str,
    ) -> Result<Vec<GitLabMilestone>, String> {
        let encoded = Self::encode_path(project_path);
        let mut all = Vec::new();
        let mut page = 1u32;
        loop {
            let url = format!(
                "{}/api/v4/projects/{}/milestones?state=active&per_page=100&page={}",
                self.base_url, encoded, page
            );
            let resp = self.client.get(&url)
                .header("PRIVATE-TOKEN", &self.token)
                .send().await.map_err(Self::map_send_err)?;
            let next_page = resp.headers()
                .get("x-next-page")
                .and_then(|v| v.to_str().ok())
                .and_then(|v| v.parse::<u32>().ok());
            let resp = Self::check_status(resp).await?;
            let items: Vec<GitLabMilestone> = resp.json().await.map_err(|e| e.to_string())?;
            all.extend(items);
            match next_page {
                Some(n) => page = n,
                None => break,
            }
        }
        // Sort by iid (creation order)
        all.sort_by_key(|m| m.iid);
        Ok(all)
    }

    pub async fn list_merge_requests(
        &self,
        project_path: &str,
        state: &str,
    ) -> Result<Vec<GitLabMR>, String> {
        let encoded = Self::encode_path(project_path);
        let mut all = Vec::new();
        let mut page = 1u32;
        loop {
            let url = format!(
                "{}/api/v4/projects/{}/merge_requests?state={}&per_page=100&page={}",
                self.base_url, encoded, state, page
            );
            let resp = self.client.get(&url)
                .header("PRIVATE-TOKEN", &self.token)
                .send().await.map_err(Self::map_send_err)?;
            let next_page = resp.headers()
                .get("x-next-page")
                .and_then(|v| v.to_str().ok())
                .and_then(|v| v.parse::<u32>().ok());
            let resp = Self::check_status(resp).await?;
            let items: Vec<GitLabMR> = resp.json().await.map_err(|e| e.to_string())?;
            all.extend(items);
            match next_page {
                Some(n) => page = n,
                None => break,
            }
        }
        Ok(all)
    }

    /// Fetch raw wiki page content. Returns None if the page doesn't exist.
    /// Falls back to listing all pages when exact slug returns 404 — GitLab may
    /// auto-generate a slug from the title rather than honouring the configured slug.
    /// Passing `title` enables title-based matching in the fallback.
    pub async fn fetch_wiki_page(
        &self,
        project_path: &str,
        slug: &str,
        title: Option<&str>,
    ) -> Result<Option<String>, String> {
        let encoded = Self::encode_path(project_path);

        // 1. Try exact slug
        let url = format!(
            "{}/api/v4/projects/{}/wikis/{}",
            self.base_url, encoded, urlencoding::encode(slug)
        );
        let resp = self.client.get(&url)
            .header("PRIVATE-TOKEN", &self.token)
            .send().await.map_err(Self::map_send_err)?;

        if resp.status().as_u16() != 404 {
            let resp = Self::check_status(resp).await?;
            let page: GitLabWikiPage = resp.json().await.map_err(|e| e.to_string())?;
            return Ok(Some(page.content));
        }

        // 2. Fallback: list all wiki pages with content, match by slug or title
        let list_url = format!(
            "{}/api/v4/projects/{}/wikis?with_content=1",
            self.base_url, encoded
        );
        let list_resp = self.client.get(&list_url)
            .header("PRIVATE-TOKEN", &self.token)
            .send().await.map_err(Self::map_send_err)?;

        let status = list_resp.status().as_u16();
        if status == 404 || status == 403 {
            return Ok(None);
        }
        let list_resp = Self::check_status(list_resp).await?;
        let pages: Vec<GitLabWikiPage> = list_resp.json().await.map_err(|e| e.to_string())?;

        let slug_lower = slug.to_lowercase();
        let title_lower = title.map(|t| t.to_lowercase());

        if let Some(page) = pages.iter().find(|p| {
            p.slug.to_lowercase() == slug_lower
                || title_lower.as_deref()
                    .map(|t| p.title.to_lowercase() == t)
                    .unwrap_or(false)
        }) {
            return Ok(Some(page.content.clone()));
        }

        Ok(None)
    }

    /// Create or update a wiki page.
    /// Finds the real slug (GitLab may differ from configured slug) and PUTs to it;
    /// falls back to POST if no existing page is found.
    pub async fn push_wiki_page(
        &self,
        project_path: &str,
        slug: &str,
        title: &str,
        content: &str,
    ) -> Result<(), String> {
        let encoded = Self::encode_path(project_path);
        let body = serde_json::json!({ "content": content, "title": title, "format": "markdown" });

        // Resolve the real slug (handles slug auto-generated from title)
        let real_slug = self.find_wiki_slug(&encoded, slug, Some(title)).await?;

        if let Some(real_slug) = real_slug {
            // Page exists — PUT to update using its real slug
            let put_url = format!(
                "{}/api/v4/projects/{}/wikis/{}",
                self.base_url, encoded, urlencoding::encode(&real_slug)
            );
            let resp = self.client.put(&put_url)
                .header("PRIVATE-TOKEN", &self.token)
                .json(&body)
                .send().await.map_err(Self::map_send_err)?;
            Self::check_status(resp).await?;
        } else {
            // Page doesn't exist yet — POST to create
            let post_url = format!("{}/api/v4/projects/{}/wikis", self.base_url, encoded);
            let create_body = serde_json::json!({
                "content": content,
                "title": title,
                "format": "markdown",
                "slug": slug,
            });
            let resp = self.client.post(&post_url)
                .header("PRIVATE-TOKEN", &self.token)
                .json(&create_body)
                .send().await.map_err(Self::map_send_err)?;
            Self::check_status(resp).await?;
        }
        Ok(())
    }
}
