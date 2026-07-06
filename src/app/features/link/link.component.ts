import { Component, computed, effect, ElementRef, HostListener, inject, signal, OnInit, ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { SyncStore } from '../../core/sync.store';
import { AppStateService } from '../../core/app-state.service';
import { ConfigService } from '../../core/config.service';
import { SessionStore } from '../../core/session.store';
import { TauriBridgeService } from '../../core/tauri-bridge.service';
import { NotificationService } from '../../core/notification.service';
import { ProjectSwitcherComponent } from '../shared/project-switcher.component';
import { Issue, Branch, LinkDiffPreview } from '../../models';
import {
  LucideLoaderCircle, LucideDownload, LucideUpload, LucideCheck, LucideLink2, LucideSparkles,
  LucideGitBranch, LucideArrowRight, LucideX, LucideArrowUp, LucideArrowDown, LucidePencil, LucideTarget, LucideTrash2,
} from '@lucide/angular';

@Component({
  selector: 'app-link',
  imports: [
    FormsModule, ProjectSwitcherComponent,
    LucideLoaderCircle, LucideDownload, LucideUpload, LucideCheck, LucideLink2, LucideSparkles,
    LucideGitBranch, LucideArrowRight, LucideX, LucideArrowUp, LucideArrowDown, LucidePencil, LucideTarget, LucideTrash2,
  ],
  templateUrl: './link.component.html',
})
export class LinkComponent implements OnInit {
  protected syncStore = inject(SyncStore);
  protected state = inject(AppStateService);
  private config = inject(ConfigService);
  private session = inject(SessionStore);
  private bridge = inject(TauriBridgeService);
  private notifications = inject(NotificationService);

  @ViewChild('issueFilterInput') issueFilterInput?: ElementRef<HTMLInputElement>;

  @HostListener('document:keydown', ['$event'])
  protected onKeydown(event: KeyboardEvent) {
    if (event.key === '/' && !this.isTypingTarget(event.target)) {
      event.preventDefault();
      this.issueFilterInput?.nativeElement.focus();
    }
  }

  private isTypingTarget(target: EventTarget | null): boolean {
    const tag = (target as HTMLElement)?.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
  }

  constructor() {
    // Ao trocar de projeto, zera qualquer seleção em andamento — uma branch escolhida no
    // projeto A não deve ficar pendurada ao abrir o projeto B (onde ela nem existe), o que
    // poderia gerar um vínculo no projeto errado se o usuário clicasse "Vincular" sem perceber.
    let prev = this.syncStore.activeProject()?.id ?? '';
    effect(() => {
      const id = this.syncStore.activeProject()?.id ?? '';
      if (id !== prev) {
        prev = id;
        this.selectedIssue.set(null);
        this.selectedBranches.set(new Set());
      }
    });
  }

  /** Reflects the tag filter selected in Sincronizar (shared via SyncStore). */
  protected issues = this.syncStore.filteredIssues;
  protected allIssues = this.syncStore.issues;
  protected discoveredTags = this.syncStore.discoveredTags;
  protected activeTagFilter = this.syncStore.activeTagFilter;
  protected toggleTagFilter = (tag: string) => this.syncStore.toggleTagFilter(tag);
  protected branches = this.syncStore.branches;
  protected milestones = this.syncStore.milestones;
  protected allLinks = this.state.links;
  protected sprints = this.state.sprints;

  protected enabledProjects = this.syncStore.enabledProjects;
  protected activeProject = this.syncStore.activeProject;

  protected activeProjectId = computed(() => this.syncStore.activeProject()?.id ?? '');
  protected issuesProjectPath = computed(() => this.config.config()?.issuesProjectPath ?? '');

  /** Only links for the active project. */
  protected links = computed(() => {
    const pid = this.activeProjectId();
    return this.allLinks().filter(l => l.projectId === pid);
  });

  /** Lookup map for cross-referencing saved links with live issue data. */
  protected issueByIid = computed(() => new Map(this.issues().map(i => [i.iid, i])));

  protected pendingPublishCount = computed(() => this.state.pendingCount(this.activeProjectId(), 'links'));
  protected hasRemotePending = computed(() => this.state.remotePendingFor(this.activeProjectId(), 'links'));

  /** Milestones cujos títulos ainda não existem como sprint local. */
  protected importableMilestones = computed(() => {
    const existing = new Set(this.sprints());
    return this.milestones().filter(m => m.state === 'active' && !existing.has(m.title));
  });

  // Selection state
  protected selectedIssue = signal<Issue | null>(null);
  protected selectedBranches = signal<Set<string>>(new Set());
  protected selectedSprint = signal('');
  protected saving = signal(false);

  // Filter inputs
  protected issueFilter = signal('');
  protected branchFilter = signal('');
  /** Quando ativo, esconde da lista de cards os que já têm vínculo neste projeto. */
  protected hideLinkedCards = signal(false);

  // Auto-suggestions banner is collapsed by default — noisy when there are many.
  protected showSuggestions = signal(false);

  // Sprint management
  protected newSprintName = signal('');
  protected renamingSprintOld = signal('');
  protected renamingSprintNew = signal('');

  // Wiki
  protected wikiLoading = signal(false);
  protected wikiPushing = signal(false);
  protected wikiImporting = signal(false);
  protected lastWikiImport = signal<string | null>(null);

  // Conflict preview / confirmation
  protected importPreview = signal<LinkDiffPreview | null>(null);
  protected publishPreview = signal<LinkDiffPreview | null>(null);
  private pendingImportContent = '';
  private pendingPublishCtx: ReturnType<LinkComponent['wikiCtx']> = null;
  private pendingPublishExisting: string | null = null;

  protected filteredIssues = computed(() => {
    const q = this.issueFilter().toLowerCase();
    const hideLinked = this.hideLinkedCards();
    const linkedIids = hideLinked ? new Set(this.links().map(l => l.issueIid)) : null;
    return this.issues().filter(i =>
      (!q || i.title.toLowerCase().includes(q) || String(i.iid).includes(q)) &&
      (!linkedIids || !linkedIids.has(i.iid))
    );
  });

  /** Quantos dos cards atualmente visíveis (sem o filtro de vinculados) já têm vínculo. */
  protected linkedCardCount = computed(() => {
    const linkedIids = new Set(this.links().map(l => l.issueIid));
    return this.issues().filter(i => linkedIids.has(i.iid)).length;
  });

  protected filteredBranches = computed(() => {
    const q = this.branchFilter().toLowerCase();
    return this.branches().filter(b => !q || b.name.toLowerCase().includes(q));
  });

  // View filters for saved links panel
  protected viewSprintFilter = signal('');
  protected viewSearchFilter = signal('');

  /** Links per sprint, in sprint order, plus "Sem sprint" at the end. */
  protected groupedLinks = computed(() => {
    const sprints = this.sprints();
    const all = this.links();
    const groups: { sprint: string; links: typeof all }[] = [];

    for (const sprint of sprints) {
      const sprintLinks = all.filter(l => l.sprintName === sprint);
      if (sprintLinks.length) groups.push({ sprint, links: sprintLinks });
    }

    const noSprint = all.filter(l => !sprints.includes(l.sprintName));
    if (noSprint.length) groups.push({ sprint: '', links: noSprint });

    return groups;
  });

  protected filteredGroupedLinks = computed(() => {
    const sprintFilter = this.viewSprintFilter();
    const q = this.viewSearchFilter().toLowerCase();
    let groups = this.groupedLinks();
    if (sprintFilter) groups = groups.filter(g => g.sprint === sprintFilter);
    if (q) {
      groups = groups.map(g => ({
        ...g,
        links: g.links.filter(l =>
          String(l.issueIid).includes(q) ||
          l.issueTitle.toLowerCase().includes(q) ||
          l.branchNames.some(b => b.toLowerCase().includes(q))
        ),
      })).filter(g => g.links.length > 0);
    }
    return groups;
  });

  protected filteredLinksCount = computed(() =>
    this.filteredGroupedLinks().reduce((sum, g) => sum + g.links.length, 0)
  );

  /** Auto-detect branch → issue links by extracting numbers from branch names. */
  protected autoSuggestions = computed(() => {
    const issues = this.issues();
    const branches = this.branches();
    const existingLinks = this.links();
    if (!issues.length || !branches.length) return [];

    const linkedBranchNames = new Set(existingLinks.flatMap(l => l.branchNames));
    const issueByIid = new Map(issues.map(i => [i.iid, i]));
    const suggestions: { issue: Issue; branch: Branch }[] = [];

    for (const branch of branches) {
      if (linkedBranchNames.has(branch.name)) continue;
      const nums = [...branch.name.matchAll(/(\d+)/g)].map(m => parseInt(m[1], 10));
      for (const iid of nums) {
        const issue = issueByIid.get(iid);
        if (issue) { suggestions.push({ issue, branch }); break; }
      }
    }
    return suggestions;
  });

  // Progressive reveal — avoids a wall of chips when there are many suggestions/sprints.
  protected suggestionsShown = signal(10);
  protected displayedSuggestions = computed(() => this.autoSuggestions().slice(0, this.suggestionsShown()));
  protected showMoreSuggestions() { this.suggestionsShown.update(n => n + 20); }

  protected sprintsShown = signal(15);
  /** Most recently added sprint first (reverse insertion order), paginated. */
  protected displayedSprints = computed(() => [...this.sprints()].reverse().slice(0, this.sprintsShown()));
  protected showMoreSprints() { this.sprintsShown.update(n => n + 15); }
  protected sprintRealIndex(name: string): number { return this.sprints().indexOf(name); }

  async ngOnInit() {
    await this.state.load();
    if (this.sprints().length > 0 && !this.selectedSprint()) {
      this.selectedSprint.set(this.sprints()[0]);
    }
    await this.silentPullFromWiki();
  }

  private async silentPullFromWiki() {
    const ctx = this.wikiCtx();
    if (!ctx) return;
    this.wikiImporting.set(true);
    try {
      const content = await this.bridge.fetchWikiPage(ctx.baseUrl, ctx.token, ctx.projectPath, ctx.slug, ctx.title);
      if (content && await this.state.mergeLinksFromMarkdown(content, ctx.projectId)) {
        this.lastWikiImport.set(new Date().toISOString());
      }
    } catch { /* silencioso */ } finally {
      this.wikiImporting.set(false);
    }
  }

  protected formatLastImport(iso: string): string {
    return new Date(iso).toLocaleString('pt-BR', {
      day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
    });
  }

  protected formatDueDate(iso: string): string {
    return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' });
  }

  protected selectIssue(issue: Issue) {
    if (this.selectedIssue()?.iid === issue.iid) {
      this.selectedIssue.set(null);
      this.selectedBranches.set(new Set());
    } else {
      this.selectedIssue.set(issue);
      const existing = this.links().find(l => l.issueIid === issue.iid);
      this.selectedBranches.set(new Set(existing?.branchNames ?? []));
      if (existing?.sprintName) this.selectedSprint.set(existing.sprintName);
    }
  }

  protected toggleBranch(name: string) {
    const s = new Set(this.selectedBranches());
    s.has(name) ? s.delete(name) : s.add(name);
    this.selectedBranches.set(s);
  }

  protected isBranchSelected(name: string): boolean {
    return this.selectedBranches().has(name);
  }

  protected isIssueLinked(iid: number): boolean {
    return this.links().some(l => l.issueIid === iid);
  }

  protected linkedBranchesFor(iid: number): string[] {
    return this.links().find(l => l.issueIid === iid)?.branchNames ?? [];
  }

  protected sprintOfIssue(iid: number): string {
    return this.links().find(l => l.issueIid === iid)?.sprintName ?? '';
  }

  protected canSave = computed(() =>
    this.selectedIssue() !== null && this.selectedBranches().size > 0
  );

  async save() {
    const issue = this.selectedIssue();
    const projectId = this.activeProjectId();
    if (!issue || !projectId || this.selectedBranches().size === 0) return;
    this.saving.set(true);
    try {
      await this.state.addLink(issue.iid, issue.title, [...this.selectedBranches()], this.selectedSprint(), projectId);
      this.selectedIssue.set(null);
      this.selectedBranches.set(new Set());
    } finally {
      this.saving.set(false);
    }
  }

  protected csvState = signal<'idle' | 'downloading' | 'done'>('idle');
  protected csvSavedName = signal('');
  protected csvImportState = signal<'idle' | 'importing' | 'done'>('idle');
  protected csvImportMessage = signal('');

  async exportCsv() {
    this.csvState.set('downloading');
    const rows: string[][] = [['Sprint', 'Card', 'Título', 'Branches']];
    for (const grp of this.groupedLinks()) {
      for (const l of grp.links) {
        rows.push([grp.sprint || 'Sem sprint', `#${l.issueIid}`, l.issueTitle, l.branchNames.join('; ')]);
      }
    }
    const filename = `vinculos-${new Date().toISOString().slice(0, 10)}.csv`;
    const csv = rows.map(r => r.map(c => `"${c.replace(/"/g, '""')}"`).join(',')).join('\r\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    try {
      if ('showSaveFilePicker' in window) {
        const handle = await (window as any).showSaveFilePicker({
          suggestedName: filename,
          types: [{ description: 'Arquivo CSV', accept: { 'text/csv': ['.csv'] } }],
        });
        const writable = await handle.createWritable();
        await writable.write(blob);
        await writable.close();
        this.csvSavedName.set(handle.name);
      } else {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = filename; a.click();
        URL.revokeObjectURL(url);
        this.csvSavedName.set(filename);
      }
      this.csvState.set('done');
      setTimeout(() => { this.csvState.set('idle'); this.csvSavedName.set(''); }, 5000);
    } catch {
      this.csvState.set('idle');
    }
  }

  async importCsv() {
    const projectId = this.activeProjectId();
    if (!projectId) return;
    let text: string;
    try {
      if ('showOpenFilePicker' in window) {
        const [handle] = await (window as any).showOpenFilePicker({
          types: [{ description: 'Arquivo CSV', accept: { 'text/csv': ['.csv'] } }],
          multiple: false,
        });
        const file = await handle.getFile();
        text = await file.text();
      } else {
        text = await new Promise<string>((resolve, reject) => {
          const input = document.createElement('input');
          input.type = 'file'; input.accept = '.csv';
          input.onchange = async () => {
            const f = input.files?.[0];
            if (!f) { reject(new Error('no file')); return; }
            resolve(await f.text());
          };
          input.click();
        });
      }
    } catch { return; }

    this.csvImportState.set('importing');
    const rows = parseCsv(text).slice(1); // skip header
    const parsed = rows
      .filter(r => r[1]?.match(/\d+/))
      .map(r => ({
        sprintName: r[0]?.trim() === 'Sem sprint' ? '' : (r[0]?.trim() ?? ''),
        issueIid: parseInt(r[1]?.match(/(\d+)/)?.[1] ?? '0', 10),
        issueTitle: r[2]?.trim() ?? '',
        branchNames: (r[3] ?? '').split(';').map((b: string) => b.trim()).filter(Boolean),
      }))
      .filter(r => r.issueIid > 0);
    const { added, updated } = await this.state.mergeCsvLinks(parsed, projectId);
    this.csvImportState.set('done');
    this.csvImportMessage.set(`CSV importado: +${added} adicionados, ~${updated} atualizados.`);
    setTimeout(() => { this.csvImportState.set('idle'); this.csvImportMessage.set(''); }, 5000);
  }

  async acceptSuggestion(issue: Issue, branch: Branch) {
    const projectId = this.activeProjectId();
    if (!projectId) return;
    await this.state.addLink(issue.iid, issue.title, [branch.name], this.selectedSprint(), projectId);
  }

  async acceptAllSuggestions() {
    const projectId = this.activeProjectId();
    const sprint = this.selectedSprint();
    if (!projectId) return;
    for (const { issue, branch } of this.autoSuggestions()) {
      await this.state.addLink(issue.iid, issue.title, [branch.name], sprint, projectId);
    }
  }

  async removeLink(issueIid: number) {
    await this.state.removeLink(issueIid, this.activeProjectId());
  }

  async removeBranch(issueIid: number, branchName: string) {
    await this.state.removeBranchFromLink(issueIid, branchName, this.activeProjectId());
  }

  async moveLink(issueIid: number, sprintName: string) {
    await this.state.moveLink(issueIid, sprintName, this.activeProjectId());
  }

  async importMilestones() {
    for (const m of this.importableMilestones()) {
      await this.state.addSprint(m.title);
    }
    if (this.sprints().length && !this.selectedSprint()) {
      this.selectedSprint.set(this.sprints()[0]);
    }
  }

  // Sprint management
  async addSprint() {
    const name = this.newSprintName().trim();
    if (!name) return;
    await this.state.addSprint(name);
    this.selectedSprint.set(name);
    this.newSprintName.set('');
  }

  protected onSprintKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter') { event.preventDefault(); this.addSprint(); }
  }

  async removeSprint(name: string) {
    await this.state.removeSprint(name);
    if (this.selectedSprint() === name) {
      this.selectedSprint.set(this.sprints()[0] ?? '');
    }
  }

  async moveSprint(name: string, dir: 'up' | 'down') {
    await this.state.moveSprint(name, dir);
  }

  startRenameSprint(name: string) {
    this.renamingSprintOld.set(name);
    this.renamingSprintNew.set(name);
  }

  async confirmRenameSprint() {
    await this.state.renameSprint(this.renamingSprintOld(), this.renamingSprintNew());
    if (this.selectedSprint() === this.renamingSprintOld()) {
      this.selectedSprint.set(this.renamingSprintNew());
    }
    this.renamingSprintOld.set('');
  }

  cancelRenameSprint() { this.renamingSprintOld.set(''); }

  // Wiki
  private wikiCtx() {
    const project = this.syncStore.activeProject();
    const token = this.session.token();
    const cfg = this.config.config();
    if (!project || !token || !cfg) return null;
    return {
      baseUrl: cfg.gitlabBaseUrl,
      token,
      projectId: project.id,
      projectPath: project.wikiProjectPath,
      slug: project.linksSlug,
      title: project.linksWikiTitle?.trim() || project.linksSlug,
    };
  }

  private errMsg(e: unknown): string {
    if (typeof e === 'string') return e;
    return (e as any)?.message ?? 'Erro desconhecido.';
  }

  async pullFromWiki() {
    const ctx = this.wikiCtx();
    if (!ctx) { this.notifications.push('error', 'Configure um projeto com Wiki nas Configurações.'); return; }
    this.wikiLoading.set(true);
    try {
      const content = await this.bridge.fetchWikiPage(ctx.baseUrl, ctx.token, ctx.projectPath, ctx.slug, ctx.title);
      if (!content) {
        this.notifications.push('error', 'Página não encontrada no Wiki. Publique primeiro ou verifique o slug nas Configurações.');
        return;
      }
      const preview = this.state.previewLinkImport(content, ctx.projectId);
      if (!preview) {
        this.notifications.push('error', 'Página encontrada mas não possui dados Nexus-Git. Publique via Nexus-Git para habilitar a importação.');
        return;
      }
      if (preview.toUpdate.length > 0) {
        this.pendingImportContent = content;
        this.importPreview.set(preview);
      } else {
        await this.state.importLinksFromMarkdown(content, ctx.projectId);
        this.lastWikiImport.set(new Date().toISOString());
        const msg = preview.toAdd.length
          ? `Importado! +${preview.toAdd.length} vínculo(s) adicionado(s).`
          : 'Wiki já sincronizado. Nenhuma alteração.';
        this.notifications.push('success', msg);
      }
    } catch (e: unknown) {
      this.notifications.push('error', this.errMsg(e));
    } finally {
      this.wikiLoading.set(false);
    }
  }

  async confirmImport() {
    const ctx = this.wikiCtx()!;
    const content = this.pendingImportContent;
    const preview = this.importPreview()!;
    this.importPreview.set(null);
    this.pendingImportContent = '';
    await this.state.importLinksFromMarkdown(content, ctx.projectId);
    this.lastWikiImport.set(new Date().toISOString());
    const parts: string[] = [];
    if (preview.toAdd.length) parts.push(`+${preview.toAdd.length}`);
    if (preview.toUpdate.length) parts.push(`~${preview.toUpdate.length} atualizados`);
    this.notifications.push('success', `Importado! ${parts.join(', ') || 'Nenhuma alteração.'}`);
  }

  cancelImport() {
    this.importPreview.set(null);
    this.pendingImportContent = '';
  }

  async pushToWiki() {
    const ctx = this.wikiCtx();
    if (!ctx) { this.notifications.push('error', 'Configure um projeto com Wiki nas Configurações.'); return; }
    this.wikiPushing.set(true);
    try {
      const existing = await this.bridge.fetchWikiPage(ctx.baseUrl, ctx.token, ctx.projectPath, ctx.slug, ctx.title);
      const preview = this.state.previewLinkPublish(existing, ctx.projectId);

      if (preview.toUpdate.length > 0 || preview.toRemove.length > 0) {
        this.wikiPushing.set(false);
        this.pendingPublishCtx = ctx;
        this.pendingPublishExisting = existing;
        this.publishPreview.set(preview);
        return;
      }
      await this.doPushToWiki(ctx, existing);
    } catch (e: unknown) {
      this.notifications.push('error', this.errMsg(e));
    } finally {
      this.wikiPushing.set(false);
    }
  }

  async confirmPublish() {
    const ctx = this.pendingPublishCtx!;
    const existing = this.pendingPublishExisting;
    this.publishPreview.set(null);
    this.pendingPublishCtx = null;
    this.pendingPublishExisting = null;
    this.wikiPushing.set(true);
    try {
      await this.doPushToWiki(ctx, existing);
    } catch (e: unknown) {
      this.notifications.push('error', this.errMsg(e));
    } finally {
      this.wikiPushing.set(false);
    }
  }

  cancelPublish() {
    this.publishPreview.set(null);
    this.pendingPublishCtx = null;
    this.pendingPublishExisting = null;
  }

  private async doPushToWiki(
    ctx: { baseUrl: string; token: string; projectId: string; projectPath: string; slug: string; title: string },
    existing: string | null,
  ) {
    if (existing) await this.state.mergeLinksFromMarkdown(existing, ctx.projectId);
    const content = this.state.buildLinksMarkdown(ctx.projectId);
    await this.bridge.pushWikiPage(ctx.baseUrl, ctx.token, ctx.projectPath, ctx.slug, ctx.title, content);
    await this.state.markPublished(ctx.projectId, 'links');
    this.lastWikiImport.set(new Date().toISOString());
    this.notifications.push('success', 'Publicado no Wiki com sucesso!');
  }
}

function parseCsv(text: string): string[][] {
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  const rows: string[][] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const cols: string[] = [];
    let cur = '', inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
        else inQ = !inQ;
      } else if (ch === ',' && !inQ) { cols.push(cur); cur = ''; }
      else cur += ch;
    }
    cols.push(cur);
    rows.push(cols);
  }
  return rows;
}
