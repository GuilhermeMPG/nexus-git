import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AppStateService } from '../../core/app-state.service';
import { ConfigService } from '../../core/config.service';
import { SessionStore } from '../../core/session.store';
import { ProjectConfig } from '../../models';
import {
  LucideLoaderCircle, LucideUpload, LucideFileText, LucideFolderOpen, LucideLink2,
  LucideBug, LucideCheck, LucideTriangleAlert, LucideInfo,
} from '@lucide/angular';

type PublishState = 'idle' | 'loading' | 'success' | 'error';
type PublishKind = 'links' | 'errors';

interface PublishKey {
  projectId: string;
  kind: PublishKind;
}

interface TargetStatus {
  state: PublishState;
  message: string;
  publishedAt?: string;
}

function statusKey(projectId: string, kind: PublishKind): string {
  return `${projectId}:${kind}`;
}

@Component({
  selector: 'app-publish',
  imports: [
    FormsModule,
    LucideLoaderCircle, LucideUpload, LucideFileText, LucideFolderOpen, LucideLink2,
    LucideBug, LucideCheck, LucideTriangleAlert, LucideInfo,
  ],
  templateUrl: './publish.component.html',
})
export class PublishComponent implements OnInit {
  private state = inject(AppStateService);
  private config = inject(ConfigService);
  private session = inject(SessionStore);

  protected publishingAll = signal(false);
  protected previewOpenFor = signal<string | null>(null);

  protected statuses = signal<Record<string, TargetStatus>>({});

  protected enabledProjects = computed(() =>
    (this.config.config()?.projects ?? []).filter(p => p.enabled)
  );

  protected linksCount = computed(() => this.state.links().length);
  protected errorsCount = computed(() => this.state.errors().length);
  protected sprintsCount = computed(() => this.state.sprints().length);
  protected groupsCount = computed(() => this.state.errorGroups().length);

  readonly kinds: PublishKind[] = ['links', 'errors'];

  protected preview = computed(() => {
    const key = this.previewOpenFor();
    if (!key) return '';
    const [projectId, kind] = key.split(':');
    return kind === 'links'
      ? this.state.buildLinksMarkdown(projectId)
      : this.state.buildErrorsMarkdown(projectId);
  });

  async ngOnInit() {
    await this.state.load();
  }

  protected togglePreview(projectId: string, kind: PublishKind) {
    const key = statusKey(projectId, kind);
    this.previewOpenFor.update(v => v === key ? null : key);
  }

  protected previewOpenKey(projectId: string, kind: PublishKind): boolean {
    return this.previewOpenFor() === statusKey(projectId, kind);
  }

  protected statusOf(projectId: string, kind: PublishKind): TargetStatus {
    return this.statuses()[statusKey(projectId, kind)] ?? { state: 'idle', message: '' };
  }

  protected itemCount(projectId: string, kind: PublishKind): number {
    if (kind === 'links') return this.state.links().filter(l => l.projectId === projectId).length;
    return this.state.errors().filter(e => e.projectId === projectId).length;
  }

  private ctx() {
    const cfg = this.config.config();
    const token = this.session.token();
    if (!cfg || !token) return null;
    return { baseUrl: cfg.gitlabBaseUrl, token };
  }

  private errMsg(e: unknown): string {
    if (typeof e === 'string') return e;
    return (e as any)?.message ?? 'Erro desconhecido.';
  }

  async publishOne(project: ProjectConfig, kind: PublishKind) {
    const ctx = this.ctx();
    if (!ctx) return;

    const key = statusKey(project.id, kind);
    this.setStatus(key, 'loading', 'Publicando...');
    try {
      const { count, wikiCount } = await this.state.publishProjectKind(project, kind, ctx.baseUrl, ctx.token);
      const diffStr = wikiCount !== null
        ? ` (${count - wikiCount >= 0 ? '+' : ''}${count - wikiCount} vs wiki)`
        : '';
      this.setStatus(key, 'success', `Publicado! ${count} itens${diffStr}`, new Date().toISOString());
    } catch (e: unknown) {
      this.setStatus(key, 'error', this.errMsg(e));
    }
  }

  async publishAll() {
    this.publishingAll.set(true);
    try {
      const tasks: Promise<void>[] = [];
      for (const project of this.enabledProjects()) {
        for (const kind of this.kinds) {
          tasks.push(this.publishOne(project, kind));
        }
      }
      await Promise.all(tasks);
    } finally {
      this.publishingAll.set(false);
    }
  }

  private setStatus(key: string, state: PublishState, message: string, publishedAt?: string) {
    this.statuses.update(s => ({
      ...s,
      [key]: { state, message, publishedAt: publishedAt ?? s[key]?.publishedAt },
    }));
  }

  protected kindLabel(kind: PublishKind) {
    return kind === 'links' ? 'Vínculos' : 'Erros';
  }

  protected formatDate(iso?: string) {
    if (!iso) return '';
    return new Date(iso).toLocaleString('pt-BR', {
      day: '2-digit', month: '2-digit', year: '2-digit',
      hour: '2-digit', minute: '2-digit',
    });
  }
}
