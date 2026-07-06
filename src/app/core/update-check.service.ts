import { effect, inject, Injectable, signal } from '@angular/core';
import { ConfigService } from './config.service';
import { TauriBridgeService } from './tauri-bridge.service';
import { UpdateInfo } from '../models';

/** Repo this app's own releases are published to — not user-configurable, it's this app's identity. */
const REPO = 'GuilhermeMPG/nexus-git';

/** Periodically checks GitHub Releases for a newer version of this app. Read-only and
 *  unauthenticated (public repo) — never downloads or installs anything, just surfaces a
 *  dismissible notice with a link to the release page so the user can grab the new .exe. */
@Injectable({ providedIn: 'root' })
export class UpdateCheckService {
  private config = inject(ConfigService);
  private bridge = inject(TauriBridgeService);

  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private active = signal(false);
  private wasEnabled = false;

  readonly updateInfo = signal<UpdateInfo | null>(null);
  /** The running build's own version — fetched once, independent of the periodic check
   *  (and of whether it's enabled), so it can always be shown in the UI. */
  readonly currentVersion = signal<string | null>(null);

  constructor() {
    this.bridge.appVersion().then(v => this.currentVersion.set(v)).catch(() => {});

    effect(() => {
      const cfg = this.config.config();
      this.clearTimer();
      const nowEnabled = this.active() && (cfg?.updateCheckEnabled ?? true);

      if (nowEnabled && !this.wasEnabled) {
        this.runCheck();
      }
      this.wasEnabled = nowEnabled;

      if (!nowEnabled || !cfg) return;
      const intervalMs = Math.max(30, cfg.updateCheckIntervalMin ?? 360) * 60_000;
      this.timer = setInterval(() => this.runCheck(), intervalMs);
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

  async runCheck() {
    if (this.running) return;
    this.running = true;
    try {
      const info = await this.bridge.checkForUpdate(REPO);
      this.updateInfo.set(info.updateAvailable ? info : null);
    } catch {
      // Silencioso — falha de rede numa checagem em segundo plano não deve gerar ruído.
    } finally {
      this.running = false;
    }
  }

  dismiss() {
    this.updateInfo.set(null);
  }

  // ── Release notes ("o que há de novo" nesta versão) ────────────────────────
  readonly releaseNotes = signal<string | null>(null);
  readonly releaseNotesLoading = signal(false);
  readonly releaseNotesError = signal('');

  /** Fetched on demand (only when the user opens the panel), not eagerly on every launch. */
  async loadReleaseNotes() {
    const version = this.currentVersion();
    if (!version) return;
    this.releaseNotesLoading.set(true);
    this.releaseNotesError.set('');
    this.releaseNotes.set(null);
    try {
      const notes = await this.bridge.getReleaseNotes(REPO, `v${version}`);
      this.releaseNotes.set(notes.trim() || 'Sem notas de versão para esta build.');
    } catch {
      this.releaseNotesError.set('Não foi possível carregar as notas desta versão.');
    } finally {
      this.releaseNotesLoading.set(false);
    }
  }
}
