import { Injectable, inject } from '@angular/core';
import { Router } from '@angular/router';
import { Overlays } from '@motor-fix/overlays';

import { Session } from '../dashboard/session';

// "Autentificare" and "Cont": a signed-in person goes to their dashboard;
// anyone else gets the sign-in dialog over the screen they are on.
@Injectable({ providedIn: 'root' })
export class SignInDialog {
  private readonly overlays = inject(Overlays);
  private readonly router = inject(Router);
  private readonly session = inject(Session);

  async start(): Promise<void> {
    const me = await this.session.load();
    if (me) {
      await this.router.navigateByUrl(me.landing);
      return;
    }
    const result = await this.overlays.open<'signed-in'>(
      () => import('./sign-in').then((m) => m.SignIn),
      { shape: 'dialog', title: 'public.signIn.title' },
    );
    const landing = this.session.current()?.landing;
    if (result === 'signed-in' && landing) {
      await this.router.navigateByUrl(landing);
    }
  }
}
