import { Component, HostListener, inject, OnInit, signal, computed } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ConfigService } from '../../core/config.service';
import { SessionStore } from '../../core/session.store';
import { TauriBridgeService } from '../../core/tauri-bridge.service';
import { AppStateService } from '../../core/app-state.service';
import { AppConfig, GitLabProject, ProjectConfig, WikiPage } from '../../models';
import {
  LucideLoaderCircle, LucideCheck, LucideChevronRight, LucideX, LucidePencil,
  LucideFileText, LucideTriangleAlert, LucideArrowRight,
} from '@lucide/angular';

type PickerTarget =
  | { kind: 'issues' }
  | { kind: 'projectCode'; projectIndex: number }
  | { kind: 'projectWiki'; projectIndex: number };

interface WikiPickerTarget {
  projectIndex: number;
  slugField: 'linksSlug' | 'errorsSlug';
}

@Component({
  selector: 'app-config',
  imports: [
    FormsModule,
    LucideLoaderCircle, LucideCheck, LucideChevronRight, LucideX, LucidePencil,
    LucideFileText, LucideTriangleAlert, LucideArrowRight,
  ],
  templateUrl: './config.component.html',
})
export class ConfigComponent implements OnInit {
  private configService = inject(ConfigService);
  private session = inject(SessionStore);
  private bridge = inject(TauriBridgeService);
  private appState = inject(AppStateService);

  protected form = signal<AppConfig | null>(null);
  protected saving = signal(false);
  protected saved = signal(false);
  protected saveError = signal('');

  // Project picker modal
  protected pickerOpen = signal(false);
  protected pickerTarget = signal<PickerTarget | null>(null);
  protected pickerLoading = signal(false);
  protected pickerError = signal('');
  protected pickerFilter = signal('');
  protected allProjects = signal<GitLabProject[]>([]);

  // Wiki slug picker modal
  protected wikiPickerTarget = signal<WikiPickerTarget | null>(null);
  protected wikiPickerLoading = signal(false);
  protected wikiPickerError = signal('');
  protected wikiPages = signal<WikiPage[]>([]);
  protected wikiPageFilter = signal('');

  protected filteredWikiPages = computed(() => {
    const q = this.wikiPageFilter().toLowerCase().trim();
    return this.wikiPages().filter(p =>
      !q || p.title.toLowerCase().includes(q) || p.slug.toLowerCase().includes(q)
    );
  });

  protected filteredProjects = computed(() => {
    const q = this.pickerFilter().toLowerCase().trim();
    const projects = this.allProjects();
    if (!q) return projects;
    return projects.filter(p =>
      p.name.toLowerCase().includes(q) ||
      p.path_with_namespace.toLowerCase().includes(q)
    );
  });

  protected expandedProjectIds = signal<Set<string>>(new Set());

  async ngOnInit() {
    const cfg = await this.configService.load();
    this.form.set(structuredClone(cfg));
    this.expandedProjectIds.set(new Set(cfg.projects.map(p => p.id)));
    await this.appState.load();
  }

  protected toggleProjectExpanded(id: string) {
    const expanded = new Set(this.expandedProjectIds());
    expanded.has(id) ? expanded.delete(id) : expanded.add(id);
    this.expandedProjectIds.set(expanded);
  }

  protected projects() {
    return this.form()?.projects ?? [];
  }

  protected updateField(key: keyof AppConfig, value: string | boolean | number) {
    const current = this.form();
    if (!current) return;
    this.form.set({ ...current, [key]: value });
  }

  protected updateProject(index: number, patch: Partial<ProjectConfig>) {
    const current = this.form();
    if (!current) return;
    const projects = [...current.projects];
    projects[index] = { ...projects[index], ...patch };
    this.form.set({ ...current, projects });
  }

  protected addProject() {
    const current = this.form();
    if (!current) return;
    const newProject: ProjectConfig = {
      id: crypto.randomUUID(),
      name: 'Novo projeto',
      codeProjectPath: '',
      wikiProjectPath: '',
      linksSlug: 'Relatorio-Branches-Cards',
      errorsSlug: 'Relatorio-Status-Erros',
      enabled: true,
    };
    this.form.set({ ...current, projects: [...current.projects, newProject] });
    this.expandedProjectIds.update(expanded => new Set(expanded).add(newProject.id));
  }

  protected removeProject(index: number) {
    const current = this.form();
    if (!current || current.projects.length <= 1) return;
    const project = current.projects[index];
    const linkCount = this.appState.links().filter(l => l.projectId === project.id).length;
    const errorCount = this.appState.errors().filter(e => e.projectId === project.id).length;

    if (linkCount > 0 || errorCount > 0) {
      const msg = `O projeto "${project.name}" possui ${linkCount} vínculo(s) e ${errorCount} erro(s) registrados. ` +
        `Ao salvar as configurações, esses dados serão removidos junto com o projeto. Remover mesmo assim?`;
      if (!confirm(msg)) return;
    }

    const projects = current.projects.filter((_, i) => i !== index);
    this.form.set({ ...current, projects });
  }

  // Project picker (GitLab repos)
  async openPicker(target: PickerTarget) {
    this.pickerTarget.set(target);
    this.pickerFilter.set('');
    this.pickerError.set('');
    this.pickerOpen.set(true);
    if (this.allProjects().length === 0) {
      await this.loadProjects();
    }
  }

  closePicker() { this.pickerOpen.set(false); }

  @HostListener('document:keydown.escape')
  protected onEscape() {
    if (this.pickerOpen()) this.closePicker();
    else if (this.wikiPickerTarget() !== null) this.closeWikiPicker();
  }

  protected pickerLabel() {
    const t = this.pickerTarget();
    if (!t) return '';
    if (t.kind === 'issues') return 'Origem dos cards (Issues)';
    if (t.kind === 'projectCode') return 'Repositório de branches';
    return 'Repositório da Wiki';
  }

  private async loadProjects() {
    const cfg = this.form();
    const token = this.session.token();
    if (!cfg || !token) return;
    this.pickerLoading.set(true);
    this.pickerError.set('');
    try {
      const projects = await this.bridge.listProjects(cfg.gitlabBaseUrl, token);
      this.allProjects.set(projects);
    } catch (e: any) {
      this.pickerError.set(e?.message ?? 'Erro ao carregar projetos.');
    } finally {
      this.pickerLoading.set(false);
    }
  }

  protected selectProject(project: GitLabProject) {
    const t = this.pickerTarget();
    if (!t) return;
    if (t.kind === 'issues') {
      this.updateField('issuesProjectPath', project.path_with_namespace);
    } else if (t.kind === 'projectCode') {
      this.updateProject(t.projectIndex, { codeProjectPath: project.path_with_namespace });
    } else if (t.kind === 'projectWiki') {
      this.updateProject(t.projectIndex, { wikiProjectPath: project.path_with_namespace });
    }
    this.pickerOpen.set(false);
  }

  protected projectPath(p: GitLabProject) { return p.path_with_namespace; }

  // Wiki slug picker
  async openWikiPicker(projectIndex: number, slugField: 'linksSlug' | 'errorsSlug') {
    this.wikiPickerTarget.set({ projectIndex, slugField });
    this.wikiPageFilter.set('');
    this.wikiPickerError.set('');
    this.wikiPickerLoading.set(true);
    this.wikiPages.set([]);
    const cfg = this.form();
    const token = this.session.token();
    if (!cfg || !token) { this.wikiPickerLoading.set(false); return; }
    const project = cfg.projects[projectIndex];
    const wikiPath = project?.wikiProjectPath || project?.codeProjectPath;
    if (!wikiPath) { this.wikiPickerLoading.set(false); return; }
    try {
      const pages = await this.bridge.listWikiPages(cfg.gitlabBaseUrl, token, wikiPath);
      this.wikiPages.set(pages);
    } catch (e: unknown) {
      this.wikiPickerError.set(typeof e === 'string' ? e : (e as any)?.message ?? 'Erro ao carregar páginas.');
    } finally {
      this.wikiPickerLoading.set(false);
    }
  }

  closeWikiPicker() { this.wikiPickerTarget.set(null); }

  /** Picking an existing page captures its REAL title too — that's what actually identifies
   *  the page to GitLab, so publishing keeps hitting this exact page (no risk of the app
   *  falling back to a differently-titled page, or accidentally creating a duplicate). */
  selectWikiPage(page: WikiPage) {
    const t = this.wikiPickerTarget();
    if (!t) return;
    const titleField = t.slugField === 'linksSlug' ? 'linksWikiTitle' : 'errorsWikiTitle';
    this.updateProject(t.projectIndex, { [t.slugField]: page.slug, [titleField]: page.title });
    this.closeWikiPicker();
  }

  protected wikiPickerProjectPath() {
    const t = this.wikiPickerTarget();
    if (!t) return '';
    const project = this.form()?.projects[t.projectIndex];
    return project?.wikiProjectPath || project?.codeProjectPath || '';
  }

  // Labels
  protected newLabel = signal('');

  protected addLabel() {
    const current = this.form();
    const label = this.newLabel().trim();
    if (!current || !label) return;
    if (current.issueLabels?.includes(label)) return;
    this.form.set({ ...current, issueLabels: [...(current.issueLabels ?? []), label] });
    this.newLabel.set('');
  }

  protected removeLabel(label: string) {
    const current = this.form();
    if (!current) return;
    this.form.set({ ...current, issueLabels: current.issueLabels.filter(l => l !== label) });
  }

  protected onLabelKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter') { event.preventDefault(); this.addLabel(); }
  }

  async save() {
    const cfg = this.form();
    if (!cfg) return;
    this.saving.set(true);
    this.saved.set(false);
    this.saveError.set('');
    try {
      await this.configService.save(cfg);
      // Depois de persistir a config, remove vínculos/erros de projetos que não existem mais,
      // para a lista de cada aba ficar realmente exclusiva dos projetos configurados.
      await this.appState.pruneOrphans(cfg.projects.map(p => p.id));
      this.saved.set(true);
      setTimeout(() => this.saved.set(false), 2500);
    } catch (e: unknown) {
      // Sem isso, uma falha (ex.: tipo inválido enviado ao backend) ficava silenciosa — o
      // usuário via o formulário "aceitar" a mudança mas ela nunca era persistida de fato.
      const msg = typeof e === 'string' ? e : (e as any)?.message ?? 'Erro desconhecido.';
      this.saveError.set(`Falha ao salvar: ${msg}`);
    } finally {
      this.saving.set(false);
    }
  }
}
