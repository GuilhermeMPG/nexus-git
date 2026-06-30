import { Routes } from '@angular/router';
import { authGuard } from './core/auth.guard';

export const routes: Routes = [
  { path: '', redirectTo: 'auth', pathMatch: 'full' },
  {
    path: 'auth',
    loadComponent: () =>
      import('./features/auth/auth.component').then((m) => m.AuthComponent),
  },
  {
    path: 'app',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/shell/shell.component').then((m) => m.ShellComponent),
    children: [
      { path: '', redirectTo: 'sync', pathMatch: 'full' },
      {
        path: 'sync',
        loadComponent: () =>
          import('./features/sync/sync.component').then((m) => m.SyncComponent),
      },
      {
        path: 'link',
        loadComponent: () =>
          import('./features/link/link.component').then((m) => m.LinkComponent),
      },
      {
        path: 'errors',
        loadComponent: () =>
          import('./features/errors/errors.component').then((m) => m.ErrorsComponent),
      },
      {
        path: 'dashboard',
        loadComponent: () =>
          import('./features/dashboard/dashboard.component').then((m) => m.DashboardComponent),
      },
      {
        path: 'publish',
        loadComponent: () =>
          import('./features/publish/publish.component').then((m) => m.PublishComponent),
      },
      {
        path: 'config',
        loadComponent: () =>
          import('./features/config/config.component').then((m) => m.ConfigComponent),
      },
    ],
  },
  { path: '**', redirectTo: 'auth' },
];
