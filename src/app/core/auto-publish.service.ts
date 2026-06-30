import { effect, inject, Injectable, signal } from '@angular/core';
import { ConfigService } from './config.service';
import { SessionStore } from './session.store';
import { AppStateService } from './app-state.service';
import { NotificationService } from './notification.service';

type PublishKind = 'links' | 'errors';
const KINDS: PublishKind[] = ['links', 'errors'];

/** Periodically pushes Vínculos/Erros to the Wiki for all enabled projects, in the background. */
@Injectable({ providedIn: 'root' })
export class AutoPublishService {
  private config = inject(ConfigService);
  private session = inject(SessionStore);
  private state = inject(AppStateService);
  private notifications = inject(NotificationService);

  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private active = signal(false);
  private wasEnabled = false;
  private currentCycleAbort: AbortController | null = null;

  constructor() {
    effect(() => {
      const cfg = this.config.config();
      this.clearTimer();
      const nowEnabled = this.active() && !!cfg?.autoPublishEnabled;

      if (nowEnabled && !this.wasEnabled) {
        this.runCycle();
      }
      this.wasEnabled = nowEnabled;

      if (!nowEnabled || !cfg) return;
      const intervalMs = Math.max(5, cfg.autoPublishIntervalMin ?? 30) * 60_000;
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

  /** Aborts a cycle currently in flight — call before resetting app state (e.g. on logout) to
   *  prevent publishing empty data over the Wiki mid-cycle. */
  cancelRunningCycle() {
    this.currentCycleAbort?.abort();
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
    this.currentCycleAbort = new AbortController();
    const signal = this.currentCycleAbort.signal;
    try {
      await this.state.load();
      let totalCount = 0;
      let failures = 0;

      outer:
      for (const project of projects) {
        for (const kind of KINDS) {
          try {
            const { count } = await this.state.publishProjectKind(project, kind, cfg.gitlabBaseUrl, token, signal);
            totalCount += count;
          } catch {
            if (signal.aborted) break outer;
            failures++;
          }
        }
      }

      if (signal.aborted) return;

      if (failures > 0) {
        this.notifications.push('error', `Auto-publicação: ${failures} falha(s) ao publicar na Wiki.`);
      } else {
        this.notifications.push('success', `Auto-publicação: ${totalCount} itens sincronizados com a Wiki.`);
      }
    } finally {
      this.running = false;
      this.currentCycleAbort = null;
    }
  }
}
