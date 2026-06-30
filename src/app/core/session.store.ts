import { Injectable, signal, computed } from '@angular/core';
import { TauriBridgeService } from './tauri-bridge.service';
import { ConfigService } from './config.service';
import { AppStateService } from './app-state.service';
import { SyncStore } from './sync.store';
import { GitLabUser } from '../models';

@Injectable({ providedIn: 'root' })
export class SessionStore {
  readonly token = signal<string | null>(null);
  readonly user = signal<GitLabUser | null>(null);
  readonly isAuthenticated = computed(() => this.token() !== null && this.user() !== null);

  constructor(
    private bridge: TauriBridgeService,
    private config: ConfigService,
    private appState: AppStateService,
    private syncStore: SyncStore,
  ) {}

  async tryRestoreSession(): Promise<boolean> {
    const token = await this.bridge.loadToken();
    if (!token) return false;

    const cfg = this.config.config();
    if (!cfg) return false;

    try {
      const user = await this.bridge.validateToken(cfg.gitlabBaseUrl, token);
      this.token.set(token);
      this.user.set(user);
      return true;
    } catch {
      await this.bridge.deleteToken();
      return false;
    }
  }

  setSession(token: string, user: GitLabUser) {
    this.token.set(token);
    this.user.set(user);
  }

  async logout() {
    await this.bridge.deleteToken();
    this.token.set(null);
    this.user.set(null);
    this.appState.reset();
    this.syncStore.reset();
  }
}
