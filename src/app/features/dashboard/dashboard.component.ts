import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { AppStateService } from '../../core/app-state.service';
import { SyncStore } from '../../core/sync.store';
import { LucideInbox, LucideGitBranch, LucideCheck } from '@lucide/angular';

@Component({
  selector: 'app-dashboard',
  imports: [LucideInbox, LucideGitBranch, LucideCheck],
  templateUrl: './dashboard.component.html',
})
export class DashboardComponent implements OnInit {
  private state = inject(AppStateService);
  private syncStore = inject(SyncStore);

  protected issues = this.syncStore.issues;
  /** Aggregated across all enabled projects — Dashboard is a consolidated overview, not scoped
   *  to a single active project like Sync/Vínculos/Erros. */
  protected allBranchesFlat = computed(() => this.syncStore.allBranches().map(x => x.branch));
  protected enabledProjects = this.syncStore.enabledProjects;
  protected links = this.state.links;
  protected errors = this.state.errors;
  protected sprints = this.state.sprints;

  private linkedIssueIids = computed(() => new Set(this.links().map(l => l.issueIid)));
  private linkedBranchNames = computed(() => new Set(this.links().flatMap(l => l.branchNames)));

  protected unlinkedIssues = computed(() => {
    const iids = this.linkedIssueIids();
    return this.issues().filter(i => !iids.has(i.iid));
  });

  protected orphanBranches = computed(() => {
    const names = this.linkedBranchNames();
    return this.allBranchesFlat().filter(b => !b.merged && !names.has(b.name));
  });

  protected issueCovPct = computed(() => {
    const total = this.issues().length;
    if (!total) return null;
    return Math.round(((total - this.unlinkedIssues().length) / total) * 100);
  });

  protected activeBranchCount = computed(() => this.allBranchesFlat().filter(b => !b.merged).length);

  protected linkedBranchCount = computed(() => this.activeBranchCount() - this.orphanBranches().length);

  protected branchCovPct = computed(() => {
    const total = this.activeBranchCount();
    if (!total) return null;
    return Math.round((this.linkedBranchCount() / total) * 100);
  });

  protected errorStats = computed(() => {
    const all = this.errors();
    return {
      total: all.length,
      pending: all.filter(e => e.status === 'Pendente').length,
      fp: all.filter(e => e.status === 'FalsoPositivo').length,
      resolved: all.filter(e => e.status === 'Resolvido').length,
    };
  });

  protected sprintStats = computed(() => {
    const sprints = this.sprints();
    const allLinks = this.links();
    const rows = sprints.map(sprint => ({
      label: sprint,
      count: allLinks.filter(l => l.sprintName === sprint).length,
    }));
    const noSprint = allLinks.filter(l => !sprints.includes(l.sprintName)).length;
    if (noSprint) rows.push({ label: 'Sem sprint', count: noSprint });
    return rows.filter(r => r.count > 0);
  });

  protected hasSyncData = computed(() => this.issues().length > 0 || this.allBranchesFlat().length > 0);

  protected loading = signal(true);

  async ngOnInit() {
    await this.state.load();
    this.loading.set(false);
  }
}
