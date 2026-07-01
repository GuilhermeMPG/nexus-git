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

  /**
   * 'restored': logged in. 'no-token': nothing saved (or it was confirmed invalid — deleted).
   * 'retry': a token IS saved but we couldn't confirm it right now (network/instance issue) —
   * the caller should offer to retry rather than force the user to re-enter their PAT.
   */
  async tryRestoreSession(): Promise<'restored' | 'no-token' | 'retry'> {
    let token: string | null;
    try {
      token = await this.bridge.loadToken();
    } catch {
      // Falha ao acessar o Windows Credential Manager (ex.: erro transitório do keyring) —
      // não apagamos nada nem tratamos como "sem token"; deixamos o usuário tentar de novo,
      // já que o token pode muito bem ainda estar salvo.
      return 'retry';
    }
    if (!token) return 'no-token';

    const cfg = this.config.config();
    if (!cfg) return 'no-token';

    try {
      const user = await this.bridge.validateToken(cfg.gitlabBaseUrl, token);
      this.token.set(token);
      this.user.set(user);
      return 'restored';
    } catch (e: unknown) {
      // Only wipe the saved token when GitLab actually confirmed it's invalid/revoked —
      // a transient network hiccup or a temporarily unreachable instance shouldn't force
      // the user to re-enter their PAT; just let them retry from the login screen.
      if (e === 'unauthorized') {
        await this.bridge.deleteToken();
        return 'no-token';
      }
      return 'retry';
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
