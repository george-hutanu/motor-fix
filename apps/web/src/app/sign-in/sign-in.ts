import { HttpErrorResponse } from '@angular/common/http';
import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  type ElementRef,
  Injector,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { I18n, TranslatePipe } from '@motor-fix/i18n';
import { injectOverlayTask } from '@motor-fix/overlays';

import { Session } from '../dashboard/session';

// Text, "@", and a domain with a dot; the server decides the rest.
const ADDRESS = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Text keys spelled out whole, so the workspace check finds each one.
const MESSAGES: Record<string, string> = {
  account_suspended: 'public.signIn.error.account_suspended',
  invalid_credentials: 'public.signIn.error.invalid_credentials',
  maintenance: 'public.signIn.error.maintenance',
  too_many_attempts: 'public.signIn.error.too_many_attempts',
};
const OFFLINE = 'public.signIn.error.offline';
const OTHER = 'public.signIn.error.other';

function messageFor(error: unknown): string {
  if (!(error instanceof HttpErrorResponse)) return OTHER;
  if (error.status === 0) return navigator.onLine ? OTHER : OFFLINE;
  const code = (error.error as { code?: unknown } | null)?.code;
  return (
    (typeof code === 'string' &&
      Object.hasOwn(MESSAGES, code) &&
      MESSAGES[code]) ||
    OTHER
  );
}

// The sign-in task shown in the shared dialog. It closes with "signed-in";
// whoever opened it decides where to go next.
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslatePipe],
  selector: 'mf-sign-in',
  styles: `
    form { display: grid; gap: var(--mf-space-4); }
    .brand { margin: 0; color: var(--mf-text-secondary); }
    .field { display: grid; gap: var(--mf-space-2); }
    label { font-weight: 700; }
    .error, .problem:not(:empty) { margin: 0; color: var(--mf-red); }
    .problem { margin: 0; }
    .remember { display: flex; align-items: center; gap: var(--mf-space-3); min-height: var(--mf-tap); font-weight: 400; cursor: pointer; }
    .remember input { width: 20px; height: 20px; margin: 0; accent-color: var(--mf-amber); }
    button { width: 100%; min-height: 54px; white-space: normal; }
    .spartan-input[aria-invalid='true'] { border-color: var(--mf-red); }
  `,
  template: `
    <form novalidate (submit)="submit($event)">
      <p class="brand">{{ 'public.signIn.brand' | t }}</p>
      <div class="field">
        <label for="mf-sign-in-email">{{ 'public.signIn.email' | t }}</label>
        <input
          #emailInput
          id="mf-sign-in-email"
          class="spartan-input"
          type="email"
          inputmode="email"
          autocomplete="email"
          spellcheck="false"
          [placeholder]="'public.signIn.emailPlaceholder' | t"
          [value]="email()"
          [attr.aria-invalid]="emailError() ? 'true' : null"
          [attr.aria-describedby]="emailError() ? 'mf-sign-in-email-error' : null"
          (input)="email.set(emailInput.value)"
        />
        @if (emailError(); as error) {
          <p id="mf-sign-in-email-error" class="error">{{ error | t }}</p>
        }
      </div>
      <div class="field">
        <label for="mf-sign-in-password">{{ 'public.signIn.password' | t }}</label>
        <input
          #passwordInput
          id="mf-sign-in-password"
          class="spartan-input"
          type="password"
          autocomplete="current-password"
          [placeholder]="'public.signIn.passwordPlaceholder' | t"
          [value]="password()"
          [attr.aria-invalid]="passwordError() ? 'true' : null"
          [attr.aria-describedby]="passwordError() ? 'mf-sign-in-password-error' : null"
          (input)="password.set(passwordInput.value)"
        />
        @if (passwordError(); as error) {
          <p id="mf-sign-in-password-error" class="error">{{ error | t }}</p>
        }
      </div>
      <label class="remember">
        <input
          #rememberInput
          type="checkbox"
          [checked]="remember()"
          (change)="remember.set(rememberInput.checked)"
        />
        <span>{{ 'public.signIn.remember' | t }}</span>
      </label>
      <p class="problem" role="alert">@if (problem(); as message) {{{ message | t }}}</p>
      <button
        type="submit"
        class="spartan-button spartan-button-variant-default"
        [disabled]="busy()"
        [attr.aria-busy]="busy() ? 'true' : null"
      >
        {{ 'public.signIn.submit' | t }}
      </button>
    </form>
  `,
})
export class SignIn {
  private readonly session = inject(Session);
  private readonly task = injectOverlayTask<undefined, 'signed-in'>();
  private readonly injector = inject(Injector);
  private readonly destroyed = inject(DestroyRef);
  private readonly emailInput =
    viewChild.required<ElementRef<HTMLInputElement>>('emailInput');
  private readonly passwordInput =
    viewChild.required<ElementRef<HTMLInputElement>>('passwordInput');

  protected readonly email = signal('');
  protected readonly password = signal('');
  protected readonly remember = signal(true);
  protected readonly emailError = signal<string | null>(null);
  protected readonly passwordError = signal<string | null>(null);
  protected readonly problem = signal<string | null>(null);
  protected readonly busy = signal(false);

  constructor() {
    void inject(I18n).enter('public');
  }

  protected async submit(event: Event) {
    event.preventDefault();
    if (this.busy()) return;
    this.problem.set(null);
    if (!this.valid()) return;
    this.busy.set(true);
    try {
      const me = await this.session.signIn(
        this.email().trim(),
        this.password(),
        this.remember(),
      );
      if (!me) throw new Error('signed in without an account');
      if (!this.destroyed.destroyed) this.task.close('signed-in');
    } catch (error) {
      if (!this.destroyed.destroyed) this.refused(error);
    } finally {
      if (!this.destroyed.destroyed) this.busy.set(false);
    }
  }

  // Marks each wrong field and focuses the first one.
  private valid(): boolean {
    const email = this.email().trim();
    this.emailError.set(
      !email
        ? 'public.signIn.invalid.emailMissing'
        : ADDRESS.test(email)
          ? null
          : 'public.signIn.invalid.emailFormat',
    );
    this.passwordError.set(
      this.password() ? null : 'public.signIn.invalid.passwordMissing',
    );
    if (this.emailError()) this.focus(this.emailInput());
    else if (this.passwordError()) this.focus(this.passwordInput());
    return !this.emailError() && !this.passwordError();
  }

  private refused(error: unknown) {
    const message = messageFor(error);
    this.problem.set(message);
    if (message === MESSAGES['invalid_credentials']) {
      this.password.set('');
      this.focus(this.passwordInput());
    }
  }

  private focus(input: ElementRef<HTMLInputElement>) {
    afterNextRender(() => input.nativeElement.focus(), {
      injector: this.injector,
    });
  }
}
