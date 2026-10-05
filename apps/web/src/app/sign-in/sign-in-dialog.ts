import { Injectable, inject } from '@angular/core';
import { Router } from '@angular/router';
import { type OverlayResult, Overlays } from '@motor-fix/overlays';

import type { AuthData, AuthSwitch } from './sign-in';
import { Session } from '../dashboard/session';

type Answer = OverlayResult<'signed-in' | AuthSwitch>;

const isSwitch = (answer: Answer): answer is AuthSwitch =>
  typeof answer === 'object';

// "Autentificare" and "Cont": a signed-in person goes to their dashboard;
// anyone else gets the sign-in dialog over the screen they are on, and can
// switch to sign-up and back, the typed e-mail going along. An API call
// refused for want of a session waits on the same dialog through gate().
@Injectable({ providedIn: 'root' })
export class SignInDialog {
  private readonly overlays = inject(Overlays);
  private readonly router = inject(Router);
  private readonly session = inject(Session);
  // At most one sign-in dialog: whoever asks while it is open waits on it.
  private open: Promise<boolean> | null = null;

  async start(): Promise<void> {
    const me = await this.session.load();
    if (me) {
      await this.router.navigateByUrl(me.landing);
      return;
    }
    const landing = (await this.dialog(false))
      ? this.session.current()?.landing
      : undefined;
    if (landing) await this.router.navigateByUrl(landing);
  }

  // Resolves true once the person has signed in or created an account; the
  // screen behind stays where it was.
  gate(): Promise<boolean> {
    return this.dialog(true);
  }

  private dialog(reason: boolean): Promise<boolean> {
    if (this.open) return this.open;
    const open = this.ask(reason).finally(() => {
      if (this.open === open) this.open = null;
    });
    this.open = open;
    return open;
  }

  private async ask(reason: boolean): Promise<boolean> {
    let result = await this.signIn(reason ? { reason } : undefined);
    // Each lap waits on a dialog; it ends when one closes signed in or cancelled.
    while (isSwitch(result)) {
      const data = { email: result.email, ...(reason && { reason }) };
      result =
        result.switchTo === 'sign-up'
          ? await this.overlays.open<'signed-in' | AuthSwitch, typeof data>(
              () => import('./sign-up').then((m) => m.SignUp),
              { data, shape: 'dialog', title: 'public.signUp.title' },
            )
          : await this.signIn(data);
    }
    return result === 'signed-in' && this.session.current() !== null;
  }

  private signIn(data?: AuthData): Promise<Answer> {
    return this.overlays.open(() => import('./sign-in').then((m) => m.SignIn), {
      ...(data && { data }),
      shape: 'dialog',
      title: 'public.signIn.title',
    });
  }
}
