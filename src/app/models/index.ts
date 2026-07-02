export type ReportKind = 'links' | 'errors';

export interface ReportTarget {
  id: string;
  kind: ReportKind;
  wikiSlug: string;
  enabled: boolean;
}

export interface ProjectConfig {
  id: string;
  name: string;
  codeProjectPath: string;
  wikiProjectPath: string;
  linksSlug: string;
  errorsSlug: string;
  enabled: boolean;
}

export interface AppConfig {
  schemaVersion: number;
  gitlabBaseUrl: string;
  issuesProjectPath: string;
  projects: ProjectConfig[];
  issueLabels: string[];
  acceptInvalidCerts?: boolean;
  savedAssignees?: string[];
  autoPublishEnabled?: boolean;
  autoPublishIntervalMin?: number;
  /** Default to true: pre-fill the Sync assignee filter with the logged-in user on load. */
  defaultAssigneeMe?: boolean;
  /** Periodic read-only check for unimported Wiki changes (never auto-publishes/imports). */
  autoCheckEnabled?: boolean;
  autoCheckIntervalMin?: number;
  /** Periodic check against GitHub Releases for a newer app version (default: enabled). */
  updateCheckEnabled?: boolean;
  updateCheckIntervalMin?: number;
  // Legacy fields — present only in schema v1 configs, used by migration
  codeProjectPath?: string;
  reportTargets?: ReportTarget[];
}

export interface UpdateInfo {
  currentVersion: string;
  latestVersion: string;
  updateAvailable: boolean;
  releaseUrl: string;
}

export interface GitLabAssignee {
  username: string;
  name: string;
}

export interface Issue {
  id: number;
  iid: number;
  title: string;
  state: 'opened' | 'closed';
  web_url: string;
  assignee?: GitLabAssignee;
  labels: string[];
  milestone?: { title: string; due_date?: string };
}

export interface GitLabCommit {
  committed_date?: string;
  author_name?: string;
}

export interface Branch {
  name: string;
  merged: boolean;
  web_url: string;
  commit?: GitLabCommit;
}

export interface Milestone {
  id: number;
  iid: number;
  title: string;
  state: 'active' | 'closed';
  due_date?: string;
}

export interface MergeRequest {
  iid: number;
  title: string;
  state: 'opened' | 'closed' | 'merged';
  draft: boolean;
  source_branch: string;
  web_url: string;
}

export interface Link {
  projectId: string;
  issueIid: number;
  issueTitle: string;
  branchNames: string[];
  sprintName: string;
  createdAt: string;
  updatedAt: string;
}

export type ErrorStatus = 'Pendente' | 'FalsoPositivo' | 'Resolvido';

export interface DevError {
  id: string;
  projectId: string;
  description: string;
  branchRef?: string;
  status: ErrorStatus;
  groupName?: string;
  reportedBy?: string;
  resolutionBranch?: string;
  resolutionDescription?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AppState {
  links: Link[];
  errors: DevError[];
  sprints: string[];
  errorGroups: string[];
  /** Tombstones: composite keys "projectId:issueIid". */
  deletedLinkKeys?: string[];
  /** Legacy tombstones (iid-only). Migrated to deletedLinkKeys on load. */
  deletedLinkIids?: number[];
  deletedErrorIds?: string[];
  /** Last successful publish per "${projectId}:${kind}" — drives the pending-publish badge. */
  lastPublishedAt?: Record<string, string>;
}

export interface LinkChange {
  local: Link;
  wiki: Link;
}

export interface LinkDiffPreview {
  toAdd: Link[];
  toUpdate: LinkChange[];
  toRemove: Link[];
}

export interface ErrorChange {
  local: DevError;
  wiki: DevError;
}

export interface ErrorDiffPreview {
  toAdd: DevError[];
  toUpdate: ErrorChange[];
  toRemove: DevError[];
}

export interface WikiPage {
  slug: string;
  title: string;
}

export interface GitLabProject {
  id: number;
  name: string;
  path_with_namespace: string;
  web_url: string;
  description?: string;
  namespace: { name: string };
}

export interface GitLabUser {
  id: number;
  username: string;
  name: string;
  avatarUrl?: string;
}
