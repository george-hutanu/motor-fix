import { Injectable, inject } from '@angular/core';
import { Router } from '@angular/router';
import { type OverlayResult, Overlays } from '@motor-fix/overlays';

import type { AuthSwitch } from './sign-in';
import { Session } from '../dashboard/session';

type Answer = OverlayResult<'signed-in' | AuthSwitch>;

const isSwitch = (answer: Answer): answer is AuthSwitch =>
  typeof answer === 'object';

// "Autentificare" and "Cont": a signed-in person goes to their dashboard;
// anyone else gets the sign-in dialog over the screen they are on, and can
// switch to sign-up and back, the typed e-mail going along.
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
    let result = await this.signIn();
    while (isSwitch(result)) {
      const data = { email: result.email };
      result =
        result.switchTo === 'sign-up'
          ? await this.overlays.open<'signed-in' | AuthSwitch, typeof data>(
              () => import('./sign-up').then((m) => m.SignUp),
              { data, shape: 'dialog', title: 'public.signUp.title' },
            )
          : await this.signIn(data);
    }
    const landing = this.session.current()?.landing;
    if (result === 'signed-in' && landing) {
      await this.router.navigateByUrl(landing);
    }
  }

  private signIn(data?: { email: string }): Promise<Answer> {
    return this.overlays.open(() => import('./sign-in').then((m) => m.SignIn), {
      ...(data && { data }),
      shape: 'dialog',
      title: 'public.signIn.title',
    });
  }
}
