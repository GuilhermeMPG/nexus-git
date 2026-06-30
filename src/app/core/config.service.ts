import { Injectable, signal } from '@angular/core';
import { TauriBridgeService } from './tauri-bridge.service';
import { AppConfig, ProjectConfig } from '../models';

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

  /** Schema 1 → 2: synthesize a ProjectConfig from legacy codeProjectPath + reportTargets. */
  private migrate(cfg: AppConfig): AppConfig {
    if (cfg.projects && cfg.projects.length > 0) return cfg;
    if (!cfg.codeProjectPath) return cfg;

    const linksSlug =
      cfg.reportTargets?.find(t => t.kind === 'links')?.wikiSlug ?? 'Relatorio-Branches-Cards';
    const errorsSlug =
      cfg.reportTargets?.find(t => t.kind === 'errors')?.wikiSlug ?? 'Relatorio-Status-Erros';

    const defaultProject: ProjectConfig = {
      id: crypto.randomUUID(),
      name: 'Projeto principal',
      codeProjectPath: cfg.codeProjectPath,
      wikiProjectPath: cfg.codeProjectPath,
      linksSlug,
      errorsSlug,
      enabled: true,
    };

    return { ...cfg, schemaVersion: 2, projects: [defaultProject] };
  }

  async save(config: AppConfig): Promise<void> {
    await this.bridge.saveConfig(config);
    this.config.set(config);
    this.bridge.setTlsInsecure(config.acceptInvalidCerts ?? false);
  }
}
