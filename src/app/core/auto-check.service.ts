import { effect, inject, Injectable, signal } from '@angular/core';
import { ConfigService } from './config.service';
import { SessionStore } from './session.store';
import { AppStateService } from './app-state.service';

type CheckKind = 'links' | 'errors';
const KINDS: CheckKind[] = ['links', 'errors'];

/** Periodically checks (read-only) whether the Wiki has changes not yet imported locally, for
 *  all enabled projects — never publishes or imports anything, just flags the pending state
 *  that link/errors components surface as a badge next to "Importar Wiki". */
@Injectable({ providedIn: 'root' })
export class AutoCheckService {
  private config = inject(ConfigService);
  private session = inject(SessionStore);
  private state = inject(AppStateService);

  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private active = signal(false);
  private wasEnabled = false;

  constructor() {
    effect(() => {
      const cfg = this.config.config();
      this.clearTimer();
      const nowEnabled = this.active() && !!cfg?.autoCheckEnabled;

      if (nowEnabled && !this.wasEnabled) {
        this.runCycle();
      }
      this.wasEnabled = nowEnabled;

      if (!nowEnabled || !cfg) return;
      const intervalMs = Math.max(5, cfg.autoCheckIntervalMin ?? 15) * 60_000;
      this.timer = setInterval(() => this.runCycle(), intervalMs);
    });
  }

  /** Call once the shell mounts (i.e. the user is authenticated). */
  start() {
    this.active.set(true);
  }

  stop() {
    this.active.set(false);
  }

  private clearTimer() {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async runCycle() {
    if (this.running) return;
    const cfg = this.config.config();
    const token = this.session.token();
    if (!cfg || !token) return;

    const projects = cfg.projects.filter(p => p.enabled);
    if (!projects.length) return;

    this.running = true;
    try {
      await this.state.load();
      for (const project of projects) {
        for (const kind of KINDS) {
          try {
            await this.state.checkRemotePending(project, kind, cfg.gitlabBaseUrl, token);
          } catch {
            // Silencioso — falha de rede numa checagem em segundo plano não deve gerar ruído.
          }
        }
      }
    } finally {
      this.running = false;
    }
  }
}
