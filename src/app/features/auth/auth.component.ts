import { Component, inject, signal, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { SessionStore } from '../../core/session.store';
import { ConfigService } from '../../core/config.service';
import { TauriBridgeService } from '../../core/tauri-bridge.service';

@Component({
  selector: 'app-auth',
  imports: [FormsModule],
  templateUrl: './auth.component.html',
})
export class AuthComponent implements OnInit {
  private router = inject(Router);
  private session = inject(SessionStore);
  private configService = inject(ConfigService);
  private bridge = inject(TauriBridgeService);

  protected token = signal('');
  protected gitlabUrl = signal('https://gitlab.com');
  protected loading = signal(false);
  protected error = signal('');
  protected showToken = signal(false);

  async ngOnInit() {
    try {
      const cfg = await this.configService.load();
      this.gitlabUrl.set(cfg.gitlabBaseUrl);
      const restored = await this.session.tryRestoreSession();
      if (restored) {
        this.router.navigate(['/app']);
      }
    } catch {
      // Fora do contexto Tauri: mantém defaults
    }
  }

  async login() {
    const url = this.gitlabUrl().trim().replace(/\/$/, '');
    const pat = this.token().trim();

    if (!url)  { this.error.set('Informe a URL do GitLab.'); return; }
    if (!pat)  { this.error.set('Informe o Personal Access Token.'); return; }

    this.loading.set(true);
    this.error.set('');
    try {
      const user = await this.bridge.validateToken(url, pat);

      // Persiste URL e token apenas após validação bem-sucedida
      const cfg = this.configService.config() ?? {
        schemaVersion: 2,
        gitlabBaseUrl: url,
        issuesProjectPath: '',
        projects: [],
        issueLabels: [],
      };
      await this.configService.save({ ...cfg, gitlabBaseUrl: url });
      await this.bridge.saveToken(pat);
      this.session.setSession(pat, user);
      this.router.navigate(['/app']);
    } catch (e: any) {
      const msg: string = e?.message ?? String(e);
      if (msg === 'unauthorized') {
        this.error.set('Token inválido ou sem permissão. Verifique o PAT e os escopos.');
      } else if (msg === 'forbidden') {
        this.error.set('Acesso negado (403). Verifique as permissões do token.');
      } else if (msg.startsWith('http_error:')) {
        this.error.set(`Erro HTTP ${msg.split(':')[1]} ao conectar com o GitLab.`);
      } else {
        this.error.set(msg);
      }
    } finally {
      this.loading.set(false);
    }
  }
}
