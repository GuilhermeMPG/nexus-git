use serde::{Deserialize, Serialize};

// Kept only for migration reading of schema v1 configs
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ReportKind {
    #[serde(rename = "links")]
    Links,
    #[serde(rename = "errors")]
    Errors,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReportTarget {
    pub id: String,
    pub kind: ReportKind,
    pub wiki_slug: String,
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectConfig {
    pub id: String,
    pub name: String,
    pub code_project_path: String,
    pub wiki_project_path: String,
    pub links_slug: String,
    pub errors_slug: String,
    #[serde(default = "default_true")]
    pub enabled: bool,
}

fn default_true() -> bool {
    true
}

fn default_auto_publish_interval_min() -> u32 {
    30
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppConfig {
    pub schema_version: u32,
    pub gitlab_base_url: String,
    pub issues_project_path: String,
    /// Multi-project configuration (schema v2+).
    #[serde(default)]
    pub projects: Vec<ProjectConfig>,
    #[serde(default)]
    pub issue_labels: Vec<String>,
    #[serde(default)]
    pub accept_invalid_certs: bool,
    #[serde(default)]
    pub saved_assignees: Vec<String>,
    #[serde(default)]
    pub auto_publish_enabled: bool,
    #[serde(default = "default_auto_publish_interval_min")]
    pub auto_publish_interval_min: u32,
    /// Legacy schema v1 field — present only when migrating old configs.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub code_project_path: Option<String>,
    /// Legacy schema v1 field — present only when migrating old configs.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub report_targets: Vec<ReportTarget>,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            schema_version: 2,
            gitlab_base_url: "https://gitlab.com".to_string(),
            issues_project_path: String::new(),
            projects: vec![],
            issue_labels: vec![],
            accept_invalid_certs: false,
            saved_assignees: vec![],
            auto_publish_enabled: false,
            auto_publish_interval_min: default_auto_publish_interval_min(),
            // No legacy seed — fresh installs start with zero projects configured.
            code_project_path: None,
            report_targets: vec![
                ReportTarget {
                    id: "links-default".to_string(),
                    kind: ReportKind::Links,
                    wiki_slug: "Relatorio-Branches-Cards".to_string(),
                    enabled: true,
                },
                ReportTarget {
                    id: "errors-default".to_string(),
                    kind: ReportKind::Errors,
                    wiki_slug: "Relatorio-Status-Erros".to_string(),
                    enabled: true,
                },
            ],
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Link {
    /// Identifies which ProjectConfig this link belongs to.
    #[serde(default)]
    pub project_id: String,
    pub issue_iid: u64,
    pub issue_title: String,
    pub branch_names: Vec<String>,
    pub sprint_name: String,
    pub created_at: String,
    #[serde(default)]
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum ErrorStatus {
    Pendente,
    FalsoPositivo,
    Resolvido,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DevError {
    pub id: String,
    /// Identifies which ProjectConfig this error belongs to.
    #[serde(default)]
    pub project_id: String,
    pub description: String,
    pub branch_ref: Option<String>,
    pub status: ErrorStatus,
    pub group_name: Option<String>,
    pub reported_by: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub resolution_branch: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub resolution_description: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct AppState {
    pub links: Vec<Link>,
    pub errors: Vec<DevError>,
    #[serde(default)]
    pub sprints: Vec<String>,
    #[serde(default)]
    pub error_groups: Vec<String>,
    /// Tombstones: composite keys "projectId:issueIid".
    #[serde(default)]
    pub deleted_link_keys: Vec<String>,
    /// Legacy tombstones (iid-only, pre-multi-project). Migrated to deleted_link_keys in TS.
    #[serde(default)]
    pub deleted_link_iids: Vec<u64>,
    #[serde(default)]
    pub deleted_error_ids: Vec<String>,
}
