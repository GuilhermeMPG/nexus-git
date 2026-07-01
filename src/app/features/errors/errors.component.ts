import { Component, computed, ElementRef, HostListener, inject, signal, OnInit, ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AppStateService } from '../../core/app-state.service';
import { ConfigService } from '../../core/config.service';
import { SessionStore } from '../../core/session.store';
import { TauriBridgeService } from '../../core/tauri-bridge.service';
import { SyncStore } from '../../core/sync.store';
import { NotificationService } from '../../core/notification.service';
import { ProjectSwitcherComponent } from '../shared/project-switcher.component';
import { DevError, ErrorStatus, ErrorDiffPreview } from '../../models';
import { WIKI_TITLE_ERRORS } from '../../core/wiki-constants';
import {
  LucideGitBranch, LucideLoaderCircle, LucideDownload, LucideUpload, LucideCheck, LucideX,
  LucideChevronDown, LucidePencil, LucideTrash2, LucideArrowRight, LucideKeyboard, LucideList,
} from '@lucide/angular';

@Component({
  selector: 'app-errors',
  imports: [
    FormsModule, ProjectSwitcherComponent,
    LucideGitBranch, LucideLoaderCircle, LucideDownload, LucideUpload, LucideCheck, LucideX,
    LucideChevronDown, LucidePencil, LucideTrash2, LucideArrowRight, LucideKeyboard, LucideList,
  ],
  templateUrl: './errors.component.html',
})
export class ErrorsComponent implements OnInit {
  protected state = inject(AppStateService);
  private config = inject(ConfigService);
  private session = inject(SessionStore);
  private bridge = inject(TauriBridgeService);
  protected syncStore = inject(SyncStore);
  private notifications = inject(NotificationService);

  @ViewChild('branchFilterInput') branchFilterInput?: ElementRef<HTMLInputElement>;

  @HostListener('document:keydown', ['$event'])
  protected onKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape' && this.branchDropdownOpen()) {
      this.branchDropdownOpen.set(false);
      return;
    }
    if (event.key === '/' && !this.isTypingTarget(event.target)) {
      event.preventDefault();
      this.branchFilterInput?.nativeElement.focus();
    }
  }

  private isTypingTarget(target: EventTarget | null): boolean {
    const tag = (target as HTMLElement)?.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
  }

  protected allErrors = this.state.errors;
  protected groups = this.state.errorGroups;

  protected enabledProjects = this.syncStore.enabledProjects;
  protected activeProject = this.syncStore.activeProject;
  protected activeProjectId = computed(() => this.syncStore.activeProject()?.id ?? '');
  protected issuesProjectPath = computed(() => this.config.config()?.issuesProjectPath ?? '');

  /** Branches for the active project (used for the branch picker). */
  protected branches = this.syncStore.branches;

  /** Only errors for the active project. */
  protected errors = computed(() => {
    const pid = this.activeProjectId();
    return this.allErrors().filter(e => e.projectId === pid);
  });

  protected pendingPublishCount = computed(() => this.state.pendingCount(this.activeProjectId(), 'errors'));
  protected hasRemotePending = computed(() => this.state.remotePendingFor(this.activeProjectId(), 'errors'));

  // Form
  protected editingId = signal<string | null>(null);
  protected formDescription = signal('');
  protected formBranchRef = signal('');
  protected formBranchMode = signal<'select' | 'type'>('select');
  protected formStatus = signal<ErrorStatus>('Pendente');
  protected formGroup = signal('');
  protected formReportedBy = signal('');
  protected formResolutionBranch = signal('');
  protected formResolutionBranchMode = signal<'select' | 'type'>('select');
  protected formResolutionDescription = signal('');
  protected saving = signal(false);

  protected showResolutionFields = computed(() =>
    this.formStatus() === 'Resolvido' || this.formStatus() === 'FalsoPositivo'
  );

  // Quick-resolve inline
  protected resolvingId = signal<string | null>(null);
  protected resolveFormBranch = signal('');
  protected resolveFormBranchMode = signal<'select' | 'type'>('select');
  protected resolveFormDesc = signal('');

  // CSV state
  protected csvState = signal<'idle' | 'downloading' | 'done'>('idle');
  protected csvSavedName = signal('');
  protected csvImportState = signal<'idle' | 'importing' | 'done'>('idle');
  protected csvImportMessage = signal('');

  // Group management
  protected newGroupName = signal('');
  protected renamingGroupOld = signal('');
  protected renamingGroupNew = signal('');

  // Branch filter
  protected branchSearchFilter = signal('');
  protected branchDropdownOpen = signal(false);

  // Wiki
  protected wikiLoading = signal(false);
  protected wikiPushing = signal(false);
  protected wikiImporting = signal(false);
  protected lastWikiImport = signal<string | null>(null);

  // Bulk selection
  protected selectedErrorIds = signal<Set<string>>(new Set());

  protected selectedCount = computed(() => this.selectedErrorIds().size);

  protected allVisibleSelected = computed(() => {
    const visible = this.filteredGroupedErrors().flatMap(g => g.errors);
    return visible.length > 0 && visible.every(e => this.selectedErrorIds().has(e.id));
  });

  protected toggleSelectError(id: string) {
    const s = new Set(this.selectedErrorIds());
    s.has(id) ? s.delete(id) : s.add(id);
    this.selectedErrorIds.set(s);
  }

  protected isErrorSelected(id: string): boolean {
    return this.selectedErrorIds().has(id);
  }

  protected toggleSelectAll() {
    const visible = this.filteredGroupedErrors().flatMap(g => g.errors);
    const s = new Set(this.selectedErrorIds());
    if (this.allVisibleSelected()) {
      visible.forEach(e => s.delete(e.id));
    } else {
      visible.forEach(e => s.add(e.id));
    }
    this.selectedErrorIds.set(s);
  }

  async batchChangeStatus(status: ErrorStatus) {
    for (const id of this.selectedErrorIds()) {
      await this.state.updateError(id, { status });
    }
    this.selectedErrorIds.set(new Set());
  }

  clearSelection() { this.selectedErrorIds.set(new Set()); }

  async exportCsv() {
    this.csvState.set('downloading');
    const rows: string[][] = [['ID', 'Divisão', 'Descrição', 'Branch', 'Status', 'Reportado por', 'Data', 'Branch Solução', 'Descrição Solução']];
    for (const grp of this.groupedErrors()) {
      for (const e of grp.errors) {
        rows.push([
          e.id,
          grp.group || 'Sem divisão',
          e.description,
          e.branchRef ?? '',
          e.status,
          e.reportedBy ?? '',
          new Date(e.createdAt).toLocaleDateString('pt-BR'),
          e.resolutionBranch ?? '',
          e.resolutionDescription ?? '',
        ]);
      }
    }
    const filename = `erros-${new Date().toISOString().slice(0, 10)}.csv`;
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
    const allRows = parseCsv(text);
    if (!allRows.length) { this.csvImportState.set('idle'); return; }
    const header = allRows[0].map(h => h.trim().toLowerCase());
    const hasId = header[0] === 'id';
    const parsed = allRows.slice(1)
      .filter(r => r[hasId ? 2 : 1]?.trim())
      .map(r => hasId ? ({
        id: r[0]?.trim() ?? '',
        groupName: r[1]?.trim() === 'Sem divisão' ? '' : (r[1]?.trim() ?? ''),
        description: r[2]?.trim() ?? '',
        branchRef: r[3]?.trim() ?? '',
        status: (['Pendente', 'FalsoPositivo', 'Resolvido'].includes(r[4]?.trim() ?? '') ? r[4].trim() : 'Pendente') as ErrorStatus,
        reportedBy: r[5]?.trim() ?? '',
        resolutionBranch: r[7]?.trim() ?? '',
        resolutionDescription: r[8]?.trim() ?? '',
      }) : ({
        id: '',
        groupName: r[0]?.trim() === 'Sem divisão' ? '' : (r[0]?.trim() ?? ''),
        description: r[1]?.trim() ?? '',
        branchRef: r[2]?.trim() ?? '',
        status: (['Pendente', 'FalsoPositivo', 'Resolvido'].includes(r[3]?.trim() ?? '') ? r[3].trim() : 'Pendente') as ErrorStatus,
        reportedBy: r[4]?.trim() ?? '',
        resolutionBranch: r[6]?.trim() ?? '',
        resolutionDescription: r[7]?.trim() ?? '',
      }));
    const { added, updated } = await this.state.mergeCsvErrors(parsed, projectId);
    this.csvImportState.set('done');
    this.csvImportMessage.set(`CSV importado: +${added} adicionados, ~${updated} atualizados.`);
    setTimeout(() => { this.csvImportState.set('idle'); this.csvImportMessage.set(''); }, 5000);
  }

  // Conflict preview / confirmation
  protected importPreview = signal<ErrorDiffPreview | null>(null);
  protected publishPreview = signal<ErrorDiffPreview | null>(null);
  private pendingImportContent = '';
  private pendingPublishCtx: ReturnType<ErrorsComponent['wikiCtx']> = null;
  private pendingPublishExisting: string | null = null;

  readonly statusOptions: ErrorStatus[] = ['Pendente', 'FalsoPositivo', 'Resolvido'];

  protected filteredBranchOptions = computed(() => {
    const q = this.branchSearchFilter().toLowerCase();
    return this.branches().filter(b => !q || b.name.toLowerCase().includes(q));
  });

  // View filters for the errors table
  protected viewStatusFilter = signal<ErrorStatus | ''>('');
  protected viewBranchFilter = signal('');
  protected viewGroupFilter = signal('');

  /** Errors grouped: ordered groups first, then ungrouped. */
  protected groupedErrors = computed(() => {
    const gs = this.groups();
    const all = this.errors();
    const result: { group: string; errors: typeof all }[] = [];
    for (const g of gs) {
      const items = all.filter(e => e.groupName === g);
      if (items.length) result.push({ group: g, errors: items });
    }
    const noGroup = all.filter(e => !e.groupName || !gs.includes(e.groupName));
    if (noGroup.length) result.push({ group: '', errors: noGroup });
    return result;
  });

  protected filteredGroupedErrors = computed(() => {
    const statusFilter = this.viewStatusFilter();
    const branchQ = this.viewBranchFilter().toLowerCase();
    const groupFilter = this.viewGroupFilter();
    return this.groupedErrors()
      .filter(g => !groupFilter || g.group === groupFilter)
      .map(g => ({
        ...g,
        errors: g.errors.filter(e => {
          if (statusFilter && e.status !== statusFilter) return false;
          if (branchQ && !(e.branchRef ?? '').toLowerCase().includes(branchQ)) return false;
          return true;
        }),
      }))
      .filter(g => g.errors.length > 0);
  });

  protected filteredErrorsCount = computed(() =>
    this.filteredGroupedErrors().reduce((sum, g) => sum + g.errors.length, 0)
  );

  protected statusChipClass(status: ErrorStatus): string {
    switch (status) {
      case 'Pendente':      return 'bg-yellow-600/30 border-yellow-500/50 text-yellow-300';
      case 'FalsoPositivo': return 'bg-gray-600/30 border-gray-500/50 text-gray-300';
      case 'Resolvido':     return 'bg-emerald-600/30 border-emerald-500/50 text-emerald-300';
    }
  }

  async ngOnInit() {
    await this.state.load();
    await this.silentPullFromWiki();
  }

  private async silentPullFromWiki() {
    const ctx = this.wikiCtx();
    if (!ctx) return;
    this.wikiImporting.set(true);
    try {
      const content = await this.bridge.fetchWikiPage(ctx.baseUrl, ctx.token, ctx.projectPath, ctx.slug, this.WIKI_TITLE);
      if (content && await this.state.mergeErrorsFromMarkdown(content, ctx.projectId)) {
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

  protected resetForm() {
    this.formDescription.set('');
    this.formBranchRef.set('');
    this.formStatus.set('Pendente');
    this.formGroup.set('');
    this.formReportedBy.set('');
    this.formResolutionBranch.set('');
    this.formResolutionBranchMode.set('select');
    this.formResolutionDescription.set('');
    this.editingId.set(null);
    this.branchSearchFilter.set('');
    this.branchDropdownOpen.set(false);
  }

  protected startEdit(error: DevError) {
    this.editingId.set(error.id);
    this.formDescription.set(error.description);
    this.formBranchRef.set(error.branchRef ?? '');
    this.formStatus.set(error.status);
    this.formGroup.set(error.groupName ?? '');
    this.formReportedBy.set(error.reportedBy ?? '');
    this.formResolutionBranch.set(error.resolutionBranch ?? '');
    this.formResolutionDescription.set(error.resolutionDescription ?? '');
    this.formBranchMode.set('select');
    this.formResolutionBranchMode.set(this.isKnownBranch(error.resolutionBranch) ? 'select' : 'type');
  }

  /** Whether a branch name exists in the active project's branch list (used to pick select vs type mode). */
  protected isKnownBranch(name?: string): boolean {
    if (!name) return true;
    return this.branches().some(b => b.name === name);
  }

  protected resolveError(error: DevError) {
    this.startEdit(error);
    this.formStatus.set('Resolvido');
  }

  openQuickResolve(error: DevError) {
    this.resolvingId.set(error.id);
    this.resolveFormBranch.set('');
    this.resolveFormBranchMode.set('select');
    this.resolveFormDesc.set('');
  }

  cancelQuickResolve() {
    this.resolvingId.set(null);
    this.resolveFormBranch.set('');
    this.resolveFormBranchMode.set('select');
    this.resolveFormDesc.set('');
  }

  async submitQuickResolve(error: DevError) {
    await this.state.updateError(error.id, {
      status: 'Resolvido',
      resolutionBranch: this.resolveFormBranch().trim() || undefined,
      resolutionDescription: this.resolveFormDesc().trim() || undefined,
    });
    this.cancelQuickResolve();
  }

  protected cancelEdit() { this.resetForm(); }

  protected selectBranch(name: string) {
    this.formBranchRef.set(name);
    this.branchDropdownOpen.set(false);
    this.branchSearchFilter.set('');
  }

  protected clearBranch() {
    this.formBranchRef.set('');
    this.branchSearchFilter.set('');
  }

  async submitForm() {
    const description = this.formDescription().trim();
    if (!description) return;
    this.saving.set(true);
    try {
      const id = this.editingId();
      const projectId = this.activeProjectId();
      const resolvido = this.formStatus() !== 'Pendente';
      if (id) {
        await this.state.updateError(id, {
          description,
          branchRef: this.formBranchRef().trim() || undefined,
          status: this.formStatus(),
          groupName: this.formGroup() || undefined,
          reportedBy: this.formReportedBy().trim() || undefined,
          resolutionBranch: resolvido ? (this.formResolutionBranch().trim() || undefined) : undefined,
          resolutionDescription: resolvido ? (this.formResolutionDescription().trim() || undefined) : undefined,
        });
      } else {
        await this.state.addError(
          description,
          this.formBranchRef().trim(),
          this.formStatus(),
          projectId,
          this.formGroup() || undefined,
          this.formReportedBy().trim() || undefined,
          resolvido ? this.formResolutionBranch().trim() || undefined : undefined,
          resolvido ? this.formResolutionDescription().trim() || undefined : undefined,
        );
      }
      this.resetForm();
    } finally {
      this.saving.set(false);
    }
  }

  async deleteError(id: string) {
    await this.state.removeError(id);
    if (this.editingId() === id) this.resetForm();
  }

  // Group management
  async addGroup() {
    const name = this.newGroupName().trim();
    if (!name) return;
    await this.state.addErrorGroup(name);
    this.formGroup.set(name);
    this.newGroupName.set('');
  }

  protected onGroupKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter') { event.preventDefault(); this.addGroup(); }
  }

  async removeGroup(name: string) {
    await this.state.removeErrorGroup(name);
    if (this.formGroup() === name) this.formGroup.set('');
  }

  startRenameGroup(name: string) {
    this.renamingGroupOld.set(name);
    this.renamingGroupNew.set(name);
  }

  async confirmRenameGroup() {
    await this.state.renameErrorGroup(this.renamingGroupOld(), this.renamingGroupNew());
    if (this.formGroup() === this.renamingGroupOld()) this.formGroup.set(this.renamingGroupNew());
    this.renamingGroupOld.set('');
  }

  cancelRenameGroup() { this.renamingGroupOld.set(''); }

  protected statusClass(status: ErrorStatus): string {
    switch (status) {
      case 'Pendente':      return 'bg-yellow-500/20 text-yellow-300 border-yellow-500/30';
      case 'FalsoPositivo': return 'bg-gray-500/20 text-gray-400 border-gray-500/30';
      case 'Resolvido':     return 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30';
    }
  }

  protected formatDate(iso: string): string {
    return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' });
  }

  // Wiki
  private readonly WIKI_TITLE = WIKI_TITLE_ERRORS;

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
      slug: project.errorsSlug,
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
      const content = await this.bridge.fetchWikiPage(ctx.baseUrl, ctx.token, ctx.projectPath, ctx.slug, this.WIKI_TITLE);
      if (!content) {
        this.notifications.push('error', 'Página não encontrada. Publique primeiro ou verifique o slug nas Configurações.');
        return;
      }
      const preview = this.state.previewErrorImport(content, ctx.projectId);
      if (!preview) {
        this.notifications.push('error', 'Página sem dados Nexus-Git. Publique via Nexus-Git para habilitar a importação.');
        return;
      }
      if (preview.toUpdate.length > 0) {
        this.pendingImportContent = content;
        this.importPreview.set(preview);
      } else {
        await this.state.importErrorsFromMarkdown(content, ctx.projectId);
        this.lastWikiImport.set(new Date().toISOString());
        const msg = preview.toAdd.length
          ? `Importado! +${preview.toAdd.length} erro(s) adicionado(s).`
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
    await this.state.importErrorsFromMarkdown(content, ctx.projectId);
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
      const existing = await this.bridge.fetchWikiPage(ctx.baseUrl, ctx.token, ctx.projectPath, ctx.slug, this.WIKI_TITLE);
      const preview = this.state.previewErrorPublish(existing, ctx.projectId);

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
    ctx: { baseUrl: string; token: string; projectId: string; projectPath: string; slug: string },
    existing: string | null,
  ) {
    if (existing) await this.state.mergeErrorsFromMarkdown(existing, ctx.projectId);
    const content = this.state.buildErrorsMarkdown(ctx.projectId);
    await this.bridge.pushWikiPage(ctx.baseUrl, ctx.token, ctx.projectPath, ctx.slug, this.WIKI_TITLE, content);
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
