import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
} from '@angular/core';
import {
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { AuthService } from '@motor-fix/data-access';
import { I18n, TranslatePipe } from '@motor-fix/i18n';
import {
  FieldError,
  injectOverlayTask,
  TaskError,
  TaskSubmit,
  taskSave,
} from '@motor-fix/overlays';
import { HlmButton, HlmInput } from '@motor-fix/ui-cockpit';

import { ADDRESS, type AuthSwitch } from './sign-in';

// "Ai uitat parola?": one e-mail field. The answer is the same whether or not
// an account uses the address, so the task says the same after any send.
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FieldError,
    HlmButton,
    HlmInput,
    ReactiveFormsModule,
    TaskError,
    TaskSubmit,
    TranslatePipe,
  ],
  selector: 'mf-password-reset',
  styles: `
    form, .sent { display: grid; gap: var(--mf-space-4); }
    p { margin: 0; color: var(--mf-text-secondary); overflow-wrap: anywhere; }
    .field { display: grid; gap: var(--mf-space-2); }
    label { font-weight: 700; }
    button[type='submit'], .sent button { width: 100%; min-height: 54px; white-space: normal; }
    .back { justify-self: center; min-height: var(--mf-tap); padding: 0; border: 0; background: transparent; color: var(--mf-amber-ink); font: inherit; font-weight: 700; cursor: pointer; }
    .back:focus-visible { outline: 2px solid var(--mf-amber-ink); outline-offset: 2px; }
  `,
  template: `
    @if (sent()) {
      <div class="sent">
        <p role="status">{{ 'public.passwordReset.sent' | t }}</p>
        <button hlmBtn variant="secondary" type="button" (click)="back()">
          {{ 'public.passwordReset.back' | t }}
        </button>
      </div>
    } @else {
      <form [formGroup]="form" (ngSubmit)="save.submit()" novalidate>
        <p>{{ 'public.passwordReset.line' | t }}</p>
        <div class="field">
          <label for="mf-reset-email">{{ 'public.signIn.email' | t }}</label>
          <input
            hlmInput
            id="mf-reset-email"
            type="email"
            inputmode="email"
            autocomplete="email"
            spellcheck="false"
            formControlName="email"
            [placeholder]="'public.signIn.emailPlaceholder' | t"
            aria-describedby="mf-reset-email-error"
          />
          <mf-field-error id="mf-reset-email-error" [save]="save" [control]="form.controls.email" />
        </div>
        <mf-task-error [save]="save" />
        <button hlmBtn type="submit" [mfTaskSubmit]="save">
          {{ 'public.passwordReset.submit' | t }}
        </button>
        <button type="button" class="back" [disabled]="save.state() === 'sending'" (click)="back()">
          {{ 'public.passwordReset.back' | t }}
        </button>
      </form>
    }
  `,
})
export class PasswordReset {
  private readonly auth = inject(AuthService);
  private readonly task = injectOverlayTask<
    { email?: string } | undefined,
    AuthSwitch
  >();

  protected readonly sent = signal(false);

  protected readonly form = new FormGroup({
    email: new FormControl(this.task.data?.email ?? '', {
      nonNullable: true,
      validators: [Validators.required, Validators.pattern(ADDRESS)],
    }),
  });

  protected readonly save = taskSave({
    done: () => this.sent.set(true),
    form: this.form,
    messages: 'public.signIn',
    send: ({ email = '' }) =>
      this.auth.passwordResetControllerAsk({ body: { email: email.trim() } }),
  });

  constructor() {
    void inject(I18n).enter('public');
  }

  protected back() {
    this.task.close({
      email: this.form.controls.email.value.trim(),
      switchTo: 'sign-in',
    });
  }
}
