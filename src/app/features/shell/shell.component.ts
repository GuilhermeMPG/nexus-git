import { Component, DestroyRef, inject, OnInit } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { SessionStore } from '../../core/session.store';
import { TauriBridgeService } from '../../core/tauri-bridge.service';
import { AutoPublishService } from '../../core/auto-publish.service';
import { ToastComponent } from '../shared/toast.component';
import { LucideLayoutDashboard, LucideRefreshCw, LucideLink2, LucideBug, LucideUpload, LucideSettings, LucideLogOut } from '@lucide/angular';

interface NavItem {
  path: string;
  label: string;
  icon: string;
}

@Component({
  selector: 'app-shell',
  imports: [
    RouterOutlet, RouterLink, RouterLinkActive, ToastComponent,
    LucideLayoutDashboard, LucideRefreshCw, LucideLink2, LucideBug, LucideUpload, LucideSettings, LucideLogOut,
  ],
  templateUrl: './shell.component.html',
})
export class ShellComponent implements OnInit {
  private router = inject(Router);
  private bridge = inject(TauriBridgeService);
  private destroyRef = inject(DestroyRef);
  private autoPublish = inject(AutoPublishService);
  protected session = inject(SessionStore);

  ngOnInit() {
    this.bridge.unauthorized$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.logout());
    this.autoPublish.start();
  }

  protected nav: NavItem[] = [
    { path: '/app/dashboard', label: 'Dashboard',   icon: 'dashboard' },
    { path: '/app/sync',      label: 'Sincronizar', icon: 'sync' },
    { path: '/app/link',      label: 'Vínculos',    icon: 'link' },
    { path: '/app/errors',    label: 'Erros',       icon: 'bug' },
    { path: '/app/publish',   label: 'Publicar',    icon: 'publish' },
  ];

  async logout() {
    this.autoPublish.stop();
    this.autoPublish.cancelRunningCycle();
    await this.session.logout();
    this.router.navigate(['/auth']);
  }
}
