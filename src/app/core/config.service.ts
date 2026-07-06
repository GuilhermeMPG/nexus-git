import { Injectable, signal } from '@angular/core';
import { TauriBridgeService } from './tauri-bridge.service';
import { AppConfig, ProjectConfig } from '../models';
import { WIKI_TITLE_LINKS, WIKI_TITLE_ERRORS } from './wiki-constants';

@Injectable({ providedIn: 'root' })
export class ConfigService {
  readonly config = signal<AppConfig | null>(null);
  readonly loading = signal(false);

  constructor(private bridge: TauriBridgeService) {}

  async load(): Promise<AppConfig> {
    this.loading.set(true);
    try {
      const raw = await this.bridge.loadConfig();
      const cfg = this.migrate(raw);
      if (cfg !== raw) {
        await this.bridge.saveConfig(cfg);
      }
      this.config.set(cfg);
      this.bridge.setTlsInsecure(cfg.acceptInvalidCerts ?? false);
      return cfg;
    } finally {
      this.loading.set(false);
    }
  }

  private migrate(cfg: AppConfig): AppConfig {
    let next = cfg;

    // Schema 1 → 2: synthesize a ProjectConfig from legacy codeProjectPath + reportTargets.
    if (!(next.projects && next.projects.length > 0) && next.codeProjectPath) {
      const linksSlug =
        next.reportTargets?.find(t => t.kind === 'links')?.wikiSlug ?? 'Relatorio-Branches-Cards';
      const errorsSlug =
        next.reportTargets?.find(t => t.kind === 'errors')?.wikiSlug ?? 'Relatorio-Status-Erros';

      const defaultProject: ProjectConfig = {
        id: crypto.randomUUID(),
        name: 'Projeto principal',
        codeProjectPath: next.codeProjectPath,
        wikiProjectPath: next.codeProjectPath,
        linksSlug,
        errorsSlug,
        enabled: true,
      };
      next = { ...next, schemaVersion: 2, projects: [defaultProject] };
    }

    // Schema 2 → 3: every project used to share the SAME hardcoded Wiki page title (a global
    // constant) — meaning every project's publish actually pointed at the same physical page,
    // which only "worked" by accident with a single project. Backfill an explicit title equal
    // to that old constant for any project that already exists, so its publish keeps hitting
    // the exact page it always has. Projects added AFTER this migration get no default — their
    // first publish uses their own (distinct) slug as the title, so a fresh name always creates
    // its own separate page instead of colliding with another project's.
    if ((next.schemaVersion ?? 2) < 3) {
      next = {
        ...next,
        schemaVersion: 3,
        projects: (next.projects ?? []).map(p => ({
          ...p,
          linksWikiTitle: p.linksWikiTitle ?? WIKI_TITLE_LINKS,
          errorsWikiTitle: p.errorsWikiTitle ?? WIKI_TITLE_ERRORS,
        })),
      };
    }

    return next;
  }

  async save(config: AppConfig): Promise<void> {
    await this.bridge.saveConfig(config);
    this.config.set(config);
    this.bridge.setTlsInsecure(config.acceptInvalidCerts ?? false);
  }
}
