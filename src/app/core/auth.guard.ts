import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { SessionStore } from './session.store';

export const authGuard = () => {
  const session = inject(SessionStore);
  const router = inject(Router);
  if (session.isAuthenticated()) return true;
  return router.createUrlTree(['/auth']);
};
