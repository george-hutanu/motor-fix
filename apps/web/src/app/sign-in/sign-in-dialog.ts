import { Injectable, inject } from '@angular/core';
import { Router } from '@angular/router';
import { type OverlayResult, Overlays } from '@motor-fix/overlays';

import type { AuthData, AuthSwitch, ProviderProblem } from './sign-in';
import { type Provider, Session } from '../dashboard/session';

// What the server says on the way back from a provider, besides a session.
export type ProviderResult = 'consent' | 'cancelled' | ProviderProblem;

type Answer = OverlayResult<'signed-in' | AuthSwitch>;

const isSwitch = (answer: Answer): answer is AuthSwitch =>
  typeof answer === 'object';

// "Autentificare" and "Cont": a signed-in person goes to their dashboard;
// anyone else gets the sign-in dialog over the screen they are on, and can
// switch to sign-up, the password reset or the phone and back, the typed
// e-mail and number going along. An API call refused for want of a session waits on the same dialog
// through gate(); a reset link opens the new-password task through
// newPassword().
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
    const signedIn = await this.dialog(false);
    // Read either way, so a closed dialog drops the address the area guard kept.
    const kept = this.session.takeReturnTo();
    const next = signedIn ? (kept ?? this.session.current()?.landing) : null;
    if (next) await this.router.navigateByUrl(next);
  }

  // Resolves true once the person has signed in or created an account; the
  // screen behind stays where it was, showing the account it showed.
  gate(): Promise<boolean> {
    return this.session.keepShownWhile(this.dialog(true));
  }

  // From the reset e-mail's link: true once the new password signed the
  // person in, and the landing of their role is open.
  async newPassword(token: string): Promise<boolean> {
    const first = await this.overlays.open<
      'signed-in' | AuthSwitch,
      { token: string }
    >(() => import('./new-password').then((m) => m.NewPassword), {
      data: { token },
      shape: 'dialog',
      title: 'public.newPassword.title',
    });
    const signedIn = await this.laps(first, false);
    const landing = signedIn ? this.session.current()?.landing : undefined;
    if (landing) await this.router.navigateByUrl(landing);
    return signedIn;
  }

  // Back from a provider without a session: a new person's terms step, or
  // sign-in again, with the reason it did not work. True once signed in.
  async returned(result: ProviderResult, provider: Provider): Promise<boolean> {
    let first: Answer;
    if (result === 'consent') {
      first = await this.overlays.open<'signed-in' | AuthSwitch>(
        () => import('./provider-sign-up').then((m) => m.ProviderSignUp),
        { shape: 'dialog', title: 'public.providerSignUp.title' },
      );
    } else {
      first = await this.signIn(
        result === 'cancelled'
          ? undefined
          : { problem: { code: result, provider } },
      );
    }
    return this.laps(first, false);
  }

  // From an invite link: account creation with the invited name and e-mail
  // filled in, with sign-in one switch away. Says which way the person got a
  // session, or null when they closed it; no dashboard opens.
  async join(invited: {
    email: string;
    name: string;
  }): Promise<'signed-in' | 'signed-up' | null> {
    let from: 'sign-in' | 'sign-up' = 'sign-up';
    let result = await this.signUp(invited);
    while (isSwitch(result)) {
      if (result.switchTo === 'sign-up') {
        from = 'sign-up';
        result = await this.signUp({ email: result.email, name: invited.name });
      } else {
        if (result.switchTo !== 'reset') from = 'sign-in';
        result = await this.lap(result, false);
      }
    }
    if (result !== 'signed-in' || this.session.current() === null) return null;
    return from === 'sign-up' ? 'signed-up' : 'signed-in';
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
    return this.laps(
      await this.signIn(reason ? { reason } : undefined),
      reason,
    );
  }

  // Each lap waits on a dialog; it ends when one closes signed in or cancelled.
  private async laps(first: Answer, reason: boolean): Promise<boolean> {
    let result = first;
    while (isSwitch(result)) result = await this.lap(result, reason);
    return result === 'signed-in' && this.session.current() !== null;
  }

  private lap(to: AuthSwitch, reason: boolean): Promise<Answer> {
    const data = {
      email: to.email,
      ...(to.phone && { phone: to.phone }),
      ...(reason && { reason }),
    };
    switch (to.switchTo) {
      case 'sign-up':
        return this.signUp(data);
      case 'reset':
        return this.reset(to.email);
      case 'phone':
        return this.overlays.open<'signed-in' | AuthSwitch, AuthData>(
          () => import('./phone-sign-in').then((m) => m.PhoneSignIn),
          { data, shape: 'dialog', title: 'public.signIn.title' },
        );
      default:
        return this.signIn(data);
    }
  }

  private signUp(data: AuthData): Promise<Answer> {
    return this.overlays.open<'signed-in' | AuthSwitch, AuthData>(
      () => import('./sign-up').then((m) => m.SignUp),
      { data, shape: 'dialog', title: 'public.signUp.title' },
    );
  }

  private reset(email: string): Promise<Answer> {
    return this.overlays.open<AuthSwitch, { email: string }>(
      () => import('./password-reset').then((m) => m.PasswordReset),
      { data: { email }, shape: 'dialog', title: 'public.passwordReset.title' },
    );
  }

  private signIn(data?: AuthData): Promise<Answer> {
    return this.overlays.open(() => import('./sign-in').then((m) => m.SignIn), {
      ...(data && { data }),
      shape: 'dialog',
      title: 'public.signIn.title',
    });
  }
}
