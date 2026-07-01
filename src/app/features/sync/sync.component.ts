import { Component, computed, ElementRef, HostListener, inject, OnInit, signal, ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TauriBridgeService } from '../../core/tauri-bridge.service';
import { ConfigService } from '../../core/config.service';
import { SessionStore } from '../../core/session.store';
import { SyncStore } from '../../core/sync.store';
import { AppStateService } from '../../core/app-state.service';
import { Issue, Branch, Milestone, MergeRequest } from '../../models';
import {
  LucideChevronDown, LucideRefreshCw, LucideLoaderCircle, LucideX, LucideStar,
  LucideTriangleAlert, LucideTarget, LucideExternalLink, LucideGitBranch, LucideCheck,
} from '@lucide/angular';

type IssueState = 'opened' | 'closed' | 'all';

@Component({
  selector: 'app-sync',
  imports: [
    FormsModule,
    LucideChevronDown, LucideRefreshCw, LucideLoaderCircle, LucideX, LucideStar,
    LucideTriangleAlert, LucideTarget, LucideExternalLink, LucideGitBranch, LucideCheck,
  ],
  templateUrl: './sync.component.html',
})
export class SyncComponent implements OnInit {
  private bridge = inject(TauriBridgeService);
  private config = inject(ConfigService);
  private session = inject(SessionStore);
  protected syncStore = inject(SyncStore);
  private state = inject(AppStateService);

  @ViewChild('assigneeFilterInput') assigneeFilterInput?: ElementRef<HTMLInputElement>;

  @HostListener('document:keydown', ['$event'])
  protected onKeydown(event: KeyboardEvent) {
    if (event.key === '/' && !this.isTypingTarget(event.target)) {
      event.preventDefault();
      if (!this.filtersOpen()) this.filtersOpen.set(true);
      setTimeout(() => this.assigneeFilterInput?.nativeElement.focus());
    }
  }

  private isTypingTarget(target: EventTarget | null): boolean {
    const tag = (target as HTMLElement)?.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
  }

  // Persiste entre navegações de aba via store
  protected issues = this.syncStore.issues;
  protected branches = this.syncStore.branches;
  protected enabledProjects = this.syncStore.enabledProjects;

  // Loading / error
  protected loadingIssues = signal(false);
  protected loadingBranches = signal(false);
  protected errorIssues = signal('');
  protected errorBranches = signal('');

  // Per-project loading status
  protected projectBranchStatus = signal<Record<string, 'loading' | 'done' | 'error'>>({});

  // Issue filters
  protected assigneeFilter = signal('');
  protected issueState = signal<IssueState>('opened');
  protected activeLabels = signal<string[]>([]);

  // Local, instant tag filter — lives in SyncStore so Vínculos reflects the same selection.
  protected localTagFilter = this.syncStore.activeTagFilter;
  protected discoveredTags = this.syncStore.discoveredTags;
  protected displayedIssues = this.syncStore.filteredIssues;
  protected toggleLocalTag = (tag: string) => this.syncStore.toggleTagFilter(tag);

  // Branch display filters (client-side — no re-fetch needed)
  protected hideMerged = signal(true);
  protected branchNameFilter = signal('');

  // Collapsible secondary-filters panel (assignee + presets)
  protected filtersOpen = signal(false);

  // Context bars
  protected lastIssuesFetch = signal<{ project: string; assignee: string; labels: string[]; state: IssueState } | null>(null);
  protected lastBranchesFetch = signal<{ projects: string[] } | null>(null);

  // All config labels (for chip list)
  protected configLabels = computed(() => this.config.config()?.issueLabels ?? []);

  // Assignee presets
  protected savedAssignees = computed(() => this.config.config()?.savedAssignees ?? []);
  protected myUsername = computed(() => this.session.user()?.username ?? '');
  protected myUsernameSaved = computed(() => this.savedAssignees().includes(this.myUsername()));

  applyAssigneePreset(username: string) {
    this.assigneeFilter.set(username);
  }

  async saveAssigneePreset() {
    const name = this.assigneeFilter().trim();
    if (!name) return;
    const cfg = this.config.config();
    if (!cfg) return;
    const current = cfg.savedAssignees ?? [];
    if (current.includes(name)) return;
    await this.config.save({ ...cfg, savedAssignees: [...current, name] });
  }

  async saveMyAccount() {
    const username = this.myUsername();
    if (!username) return;
    const cfg = this.config.config();
    if (!cfg) return;
    const current = cfg.savedAssignees ?? [];
    if (current.includes(username)) return;
    await this.config.save({ ...cfg, savedAssignees: [username, ...current] });
  }

  async removeAssigneePreset(name: string) {
    const cfg = this.config.config();
    if (!cfg) return;
    await this.config.save({
      ...cfg,
      savedAssignees: (cfg.savedAssignees ?? []).filter(a => a !== name),
    });
  }

  // MR overlay: map from source_branch → MR (active project)
  protected mergeRequests = this.syncStore.mergeRequests;
  protected branchMrMap = computed(() => {
    const map = new Map<string, MergeRequest>();
    for (const mr of this.mergeRequests()) map.set(mr.source_branch, mr);
    return map;
  });

  // Coverage & gaps (scoped to active project)
  protected showCoverage = signal(false);
  private linkedIssueIids = computed(() => new Set(this.state.links().map(l => l.issueIid)));
  private linkedBranchNames = computed(() => new Set(this.state.links().flatMap(l => l.branchNames)));
  protected unlinkedIssues = computed(() => {
    const iids = this.linkedIssueIids();
    return this.issues().filter(i => !iids.has(i.iid));
  });
  protected orphanBranches = computed(() => {
    const names = this.linkedBranchNames();
    return this.branches().filter(b => !b.merged && !names.has(b.name));
  });
  protected coveragePct = computed(() => {
    const total = this.issues().length;
    if (!total) return null;
    return Math.round(((total - this.unlinkedIssues().length) / total) * 100);
  });

  protected displayedBranches = computed(() => {
    let branches = this.branches();
    if (this.hideMerged()) branches = branches.filter(b => !b.merged);
    const q = this.branchNameFilter().toLowerCase();
    if (q) branches = branches.filter(b => b.name.toLowerCase().includes(q));
    return branches;
  });

  /** Branches for a specific project (used in per-project sections). */
  protected displayedBranchesFor(projectId: string): Branch[] {
    let branches = this.syncStore.branchesFor(projectId);
    if (this.hideMerged()) branches = branches.filter(b => !b.merged);
    const q = this.branchNameFilter().toLowerCase();
    if (q) branches = branches.filter(b => b.name.toLowerCase().includes(q));
    return branches;
  }

  async ngOnInit() {
    if (this.activeLabels().length === 0) {
      this.activeLabels.set([...(this.config.config()?.issueLabels ?? [])]);
    }
    if (!this.assigneeFilter().trim() && (this.config.config()?.defaultAssigneeMe ?? true) && this.myUsername()) {
      this.assigneeFilter.set(this.myUsername());
    }
    await this.state.load();
    if (!this.issues().length && !this.branches().length) {
      await this.fetchAll();
    }
  }

  private get ctx() {
    const cfg = this.config.config()!;
    const token = this.session.token()!;
    return { baseUrl: cfg.gitlabBaseUrl, token, cfg };
  }

  async fetchIssues() {
    this.loadingIssues.set(true);
    this.errorIssues.set('');
    try {
      const { baseUrl, token, cfg } = this.ctx;
      const assignee = this.assigneeFilter().trim();
      const labels = this.activeLabels();
      const state = this.issueState();
      const [items, milestones] = await Promise.all([
        this.bridge.fetchIssues(baseUrl, token, cfg.issuesProjectPath, assignee || undefined, labels, state),
        this.bridge.fetchMilestones(baseUrl, token, cfg.issuesProjectPath).catch(() => [] as Milestone[]),
      ]);
      this.syncStore.setIssues(items);
      this.syncStore.setMilestones(milestones);
      this.lastIssuesFetch.set({ project: cfg.issuesProjectPath, assignee, labels, state });
    } catch (e: unknown) {
      this.errorIssues.set(this.humanError(e));
    } finally {
      this.loadingIssues.set(false);
    }
  }

  async fetchBranches() {
    const { baseUrl, token } = this.ctx;
    const projects = this.enabledProjects();
    if (!projects.length) return;

    this.loadingBranches.set(true);
    this.errorBranches.set('');
    this.projectBranchStatus.set({});

    try {
      await Promise.all(projects.map(async project => {
        this.projectBranchStatus.update(s => ({ ...s, [project.id]: 'loading' }));
        try {
          const [items, mrs] = await Promise.all([
            this.bridge.fetchBranches(baseUrl, token, project.codeProjectPath),
            this.bridge.fetchMergeRequests(baseUrl, token, project.codeProjectPath)
              .catch(() => [] as MergeRequest[]),
          ]);
          this.syncStore.setBranchesFor(project.id, items);
          this.syncStore.setMrFor(project.id, mrs);
          this.projectBranchStatus.update(s => ({ ...s, [project.id]: 'done' }));
        } catch {
          this.projectBranchStatus.update(s => ({ ...s, [project.id]: 'error' }));
        }
      }));

      this.lastBranchesFetch.set({ projects: projects.map(p => p.codeProjectPath) });
    } catch (e: unknown) {
      this.errorBranches.set(this.humanError(e));
    } finally {
      this.loadingBranches.set(false);
    }
  }

  async fetchAll() {
    await Promise.all([this.fetchIssues(), this.fetchBranches()]);
  }

  protected toggleLabel(label: string) {
    this.activeLabels.update(ls =>
      ls.includes(label) ? ls.filter(l => l !== label) : [...ls, label]
    );
  }

  protected issueUrl(issue: Issue) { return issue.web_url; }
  protected branchUrl(branch: Branch) { return branch.web_url; }

  async openInBrowser(url: string) {
    try { await this.bridge.openUrl(url); } catch { /* silencioso */ }
  }

  protected issueStateBadge(issue: Issue): string {
    if (this.issueState() === 'opened') return '';
    return issue.state === 'closed' ? 'fechado' : '';
  }

  protected branchDate(branch: Branch) {
    const d = branch.commit?.committed_date;
    return d ? new Date(d).toLocaleDateString('pt-BR') : '';
  }

  protected formatDueDate(iso: string): string {
    return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' });
  }

  readonly issueStates: IssueState[] = ['opened', 'closed', 'all'];

  protected stateLabel(s: IssueState): string {
    return s === 'opened' ? 'Abertos' : s === 'closed' ? 'Fechados' : 'Todos';
  }

  private humanError(e: unknown): string {
    const msg = typeof e === 'string' ? e : (e as any)?.message ?? String(e);
    if (msg === 'unauthorized') return 'Token sem permissão. Faça login novamente.';
    if (msg === 'forbidden')    return 'Acesso negado (403).';
    if (msg === 'not_found')    return 'Projeto não encontrado. Verifique o path nas Configurações.';
    return msg;
  }
}
