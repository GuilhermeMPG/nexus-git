import { computed, inject, Injectable, signal } from '@angular/core';
import { Issue, Branch, Milestone, MergeRequest, ProjectConfig } from '../models';
import { ConfigService } from './config.service';

@Injectable({ providedIn: 'root' })
export class SyncStore {
  private configService = inject(ConfigService);

  readonly issues = signal<Issue[]>([]);
  /** Local, instant tag filter — shared by Sync and Vínculos so both reflect the same selection. */
  readonly activeTagFilter = signal<string[]>([]);
  private _branchesByProject = signal<Map<string, Branch[]>>(new Map());
  private _mrsByProject = signal<Map<string, MergeRequest[]>>(new Map());
  private _milestonesByProject = signal<Map<string, Milestone[]>>(new Map());

  /** Id do projeto ativo — persiste ao trocar de aba. */
  readonly activeProjectId = signal<string>('');

  readonly enabledProjects = computed<ProjectConfig[]>(() =>
    (this.configService.config()?.projects ?? []).filter(p => p.enabled)
  );

  readonly activeProject = computed<ProjectConfig | null>(() => {
    const id = this.activeProjectId();
    const projects = this.enabledProjects();
    if (!projects.length) return null;
    return projects.find(p => p.id === id) ?? projects[0];
  });

  /** Branches do projeto ativo (para uso em Vínculos/Erros). */
  readonly branches = computed<Branch[]>(() =>
    this._branchesByProject().get(this.activeProject()?.id ?? '') ?? []
  );

  /** MRs do projeto ativo. */
  readonly mergeRequests = computed<MergeRequest[]>(() =>
    this._mrsByProject().get(this.activeProject()?.id ?? '') ?? []
  );

  /** Milestones are global (from issuesProjectPath) — stored under '__global__' key. */
  readonly milestones = computed<Milestone[]>(() =>
    this._milestonesByProject().get('__global__') ?? []
  );

  readonly discoveredTags = computed<string[]>(() => {
    const set = new Set<string>();
    for (const i of this.issues()) for (const l of i.labels) set.add(l);
    return [...set].sort();
  });

  /** Issues after applying the local tag filter — the shared view Sync and Vínculos both read. */
  readonly filteredIssues = computed<Issue[]>(() => {
    const sel = this.activeTagFilter();
    if (!sel.length) return this.issues();
    return this.issues().filter(i => sel.some(t => i.labels.includes(t)));
  });

  toggleTagFilter(tag: string) {
    this.activeTagFilter.update(ts => ts.includes(tag) ? ts.filter(t => t !== tag) : [...ts, tag]);
  }

  setIssues(items: Issue[]) { this.issues.set(items); }

  setBranchesFor(projectId: string, items: Branch[]) {
    this._branchesByProject.update(m => new Map(m).set(projectId, items));
  }

  setMrFor(projectId: string, items: MergeRequest[]) {
    this._mrsByProject.update(m => new Map(m).set(projectId, items));
  }

  setMilestonesFor(projectId: string, items: Milestone[]) {
    this._milestonesByProject.update(m => new Map(m).set(projectId, items));
  }

  /** Milestones are global (from issuesProjectPath), stored under a fixed key. */
  setMilestones(items: Milestone[]) {
    this._milestonesByProject.update(m => new Map(m).set('__global__', items));
  }

  branchesFor(projectId: string): Branch[] {
    return this._branchesByProject().get(projectId) ?? [];
  }

  /** All branches across all projects, flattened with project reference. */
  allBranches = computed<{ projectId: string; branch: Branch }[]>(() => {
    const result: { projectId: string; branch: Branch }[] = [];
    for (const [pid, branches] of this._branchesByProject()) {
      for (const b of branches) result.push({ projectId: pid, branch: b });
    }
    return result;
  });

  setActiveProject(id: string) {
    this.activeProjectId.set(id);
  }

  reset() {
    this.issues.set([]);
    this._branchesByProject.set(new Map());
    this._mrsByProject.set(new Map());
    this._milestonesByProject.set(new Map());
    this.activeProjectId.set('');
    this.activeTagFilter.set([]);
  }
}
