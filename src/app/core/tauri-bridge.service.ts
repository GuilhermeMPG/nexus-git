import { Injectable } from '@angular/core';
import { Subject } from 'rxjs';
import { invoke } from '@tauri-apps/api/core';
import { AppConfig, AppState, GitLabUser, Issue, Branch, GitLabProject, Milestone, MergeRequest, WikiPage, UpdateInfo } from '../models';

const isTauri = () => typeof (window as any).__TAURI_INTERNALS__ !== 'undefined';

/** Commands with a remote side effect — never safe to blindly retry after a network error,
 *  since a timeout doesn't tell us whether the write already landed on the server. */
const NON_IDEMPOTENT_CMDS = new Set([
  'save_config', 'save_state', 'push_wiki_page', 'save_token', 'delete_token',
]);

@Injectable({ providedIn: 'root' })
export class TauriBridgeService {
  private tlsInsecure = false;

  /** Emits when the backend returns 401 (token inválido/expirado). Shell escuta e faz logout. */
  readonly unauthorized$ = new Subject<void>();

  /** Called by ConfigService after loading config to propagate TLS setting. */
  setTlsInsecure(value: boolean) { this.tlsInsecure = value; }

  private isRetryable(cmd: string, err: unknown): boolean {
    if (NON_IDEMPOTENT_CMDS.has(cmd)) return false;
    return typeof err === 'string' && err.startsWith('network_error:');
  }

  async invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
    if (!isTauri()) {
      return Promise.reject(
        new Error('App deve ser aberto pela janela nativa do Tauri, não pelo navegador (localhost:4200).')
      );
    }
    for (let attempt = 0; ; attempt++) {
      try {
        return await invoke<T>(cmd, args);
      } catch (e) {
        if (e === 'unauthorized') this.unauthorized$.next();
        if (attempt >= 2 || !this.isRetryable(cmd, e)) throw e;
        await new Promise(r => setTimeout(r, attempt === 0 ? 500 : 1500));
      }
    }
  }

  // Auth
  saveToken(token: string) { return this.invoke<void>('save_token', { token }); }
  loadToken() { return this.invoke<string | null>('load_token'); }
  deleteToken() { return this.invoke<void>('delete_token'); }
  validateToken(baseUrl: string, token: string) {
    return this.invoke<GitLabUser>('validate_token', { baseUrl, token, acceptInvalidCerts: this.tlsInsecure });
  }

  // Config
  loadConfig() { return this.invoke<AppConfig>('load_config'); }
  saveConfig(config: AppConfig) { return this.invoke<void>('save_config', { config }); }

  // State
  loadState() { return this.invoke<AppState>('load_state'); }
  saveState(state: AppState) { return this.invoke<void>('save_state', { state }); }

  // Sync
  listProjects(baseUrl: string, token: string) {
    return this.invoke<GitLabProject[]>('list_projects', { baseUrl, token, acceptInvalidCerts: this.tlsInsecure });
  }
  fetchIssues(baseUrl: string, token: string, projectPath: string, assignee?: string, labels?: string[], state?: string) {
    return this.invoke<Issue[]>('fetch_issues', {
      baseUrl, token, acceptInvalidCerts: this.tlsInsecure, projectPath,
      assignee: assignee ?? null,
      labels: labels && labels.length > 0 ? labels : null,
      state: state ?? null,
    });
  }
  fetchBranches(baseUrl: string, token: string, projectPath: string) {
    return this.invoke<Branch[]>('fetch_branches', { baseUrl, token, acceptInvalidCerts: this.tlsInsecure, projectPath });
  }
  fetchMilestones(baseUrl: string, token: string, projectPath: string) {
    return this.invoke<Milestone[]>('fetch_milestones', {
      baseUrl, token, acceptInvalidCerts: this.tlsInsecure, projectPath,
    });
  }
  fetchMergeRequests(baseUrl: string, token: string, projectPath: string, state = 'opened') {
    return this.invoke<MergeRequest[]>('fetch_merge_requests', {
      baseUrl, token, acceptInvalidCerts: this.tlsInsecure, projectPath, state,
    });
  }

  // Wiki
  fetchWikiPage(baseUrl: string, token: string, projectPath: string, slug: string, title?: string) {
    return this.invoke<string | null>('fetch_wiki_page', {
      baseUrl, token, acceptInvalidCerts: this.tlsInsecure, projectPath, slug, title: title ?? null,
    });
  }
  pushWikiPage(baseUrl: string, token: string, projectPath: string, slug: string, title: string, content: string) {
    return this.invoke<void>('push_wiki_page', {
      baseUrl, token, acceptInvalidCerts: this.tlsInsecure, projectPath, slug, title, content,
    });
  }
  listWikiPages(baseUrl: string, token: string, projectPath: string) {
    return this.invoke<WikiPage[]>('list_wiki_pages', { baseUrl, token, acceptInvalidCerts: this.tlsInsecure, projectPath });
  }

  openUrl(url: string) {
    return this.invoke<void>('open_url', { url });
  }

  checkForUpdate(repo: string) {
    return this.invoke<UpdateInfo>('check_for_update', { repo });
  }

  appVersion() {
    return this.invoke<string>('app_version');
  }

  getReleaseNotes(repo: string, tag: string) {
    return this.invoke<string>('get_release_notes', { repo, tag });
  }
}
