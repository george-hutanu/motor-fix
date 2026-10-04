import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
} from '@angular/core';
import {
  type AbstractControl,
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  type ValidationErrors,
  Validators,
} from '@angular/forms';
import { I18n, TranslatePipe } from '@motor-fix/i18n';
import {
  FieldError,
  injectOverlayTask,
  TaskError,
  TaskSubmit,
  taskSave,
} from '@motor-fix/overlays';
import { HlmButton, HlmInput } from '@motor-fix/ui-cockpit';

import { ADDRESS, type AuthData, type AuthSwitch } from './sign-in';
import { Session } from '../dashboard/session';

// The name as it will be stored: trimmed, 2 to 80 characters. The messages
// are the shared ones for these validators.
function nameLength(control: AbstractControl): ValidationErrors | null {
  const length = String(control.value ?? '').trim().length;
  if (length === 0) return { required: true };
  if (length < 2)
    return { minlength: { actualLength: length, requiredLength: 2 } };
  if (length > 80)
    return { maxlength: { actualLength: length, requiredLength: 80 } };
  return null;
}

// The sign-up task shown in the shared dialog: a driver account, signed in at
// once. It closes with "signed-in", or with a switch back to sign-in. The
// server holds the password rule; the length is only checked here first.
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
  selector: 'mf-sign-up',
  styles: `
    form { display: grid; gap: var(--mf-space-4); }
    .intro { display: grid; gap: var(--mf-space-1); margin: 0; color: var(--mf-text-secondary); }
    .intro p { margin: 0; }
    .field { display: grid; gap: var(--mf-space-2); }
    label { font-weight: 700; }
    .secret { position: relative; }
    .secret input { padding-right: 52px; }
    .reveal { position: absolute; top: 50%; right: 3px; transform: translateY(-50%); display: inline-flex; align-items: center; justify-content: center; width: var(--mf-tap); height: var(--mf-tap); padding: 0; border: 0; border-radius: var(--mf-radius-sm, 8px); background: transparent; color: var(--mf-text-secondary); cursor: pointer; }
    .reveal[aria-pressed='true'] { color: var(--mf-text-primary); }
    .reveal:focus-visible { outline: 2px solid var(--mf-amber-ink); outline-offset: -2px; }
    button[type='submit'] { width: 100%; min-height: 54px; white-space: normal; }
    .switch { display: flex; flex-wrap: wrap; align-items: center; justify-content: center; gap: 0 var(--mf-space-2); margin: 0; color: var(--mf-text-secondary); }
    .switch button { min-height: var(--mf-tap); padding: 0; border: 0; background: transparent; color: var(--mf-amber-ink); font: inherit; font-weight: 700; cursor: pointer; }
    .switch button:focus-visible { outline: 2px solid var(--mf-amber-ink); outline-offset: 2px; }
  `,
  template: `
    <form [formGroup]="form" (ngSubmit)="save.submit()" novalidate>
      <div class="intro">
        <p>{{ 'public.signUp.brand' | t }}</p>
        <p>{{ 'public.signUp.blurb' | t }}</p>
      </div>
      <div class="field">
        <label for="mf-sign-up-name">{{ 'public.signUp.name' | t }}</label>
        <input
          hlmInput
          id="mf-sign-up-name"
          type="text"
          autocomplete="name"
          formControlName="name"
          aria-describedby="mf-sign-up-name-error"
        />
        <mf-field-error id="mf-sign-up-name-error" [save]="save" [control]="form.controls.name" />
      </div>
      <div class="field">
        <label for="mf-sign-up-email">{{ 'public.signUp.email' | t }}</label>
        <input
          hlmInput
          id="mf-sign-up-email"
          type="email"
          inputmode="email"
          autocomplete="email"
          spellcheck="false"
          formControlName="email"
          [placeholder]="'public.signUp.emailPlaceholder' | t"
          aria-describedby="mf-sign-up-email-error"
        />
        <mf-field-error id="mf-sign-up-email-error" [save]="save" [control]="form.controls.email" />
      </div>
      <div class="field">
        <label for="mf-sign-up-password">{{ 'public.signUp.password' | t }}</label>
        <div class="secret">
          <input
            hlmInput
            id="mf-sign-up-password"
            [type]="shown() ? 'text' : 'password'"
            autocomplete="new-password"
            formControlName="password"
            [placeholder]="'public.signUp.passwordPlaceholder' | t"
            aria-describedby="mf-sign-up-password-error"
          />
          <button
            type="button"
            class="reveal"
            aria-controls="mf-sign-up-password"
            [attr.aria-label]="'public.signUp.showPassword' | t"
            [attr.aria-pressed]="shown()"
            (click)="shown.set(!shown())"
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
              <circle cx="12" cy="12" r="3" />
              @if (shown()) {
                <path d="M4 4l16 16" />
              }
            </svg>
          </button>
        </div>
        <mf-field-error id="mf-sign-up-password-error" [save]="save" [control]="form.controls.password" />
      </div>
      <mf-task-error [save]="save" />
      <button hlmBtn type="submit" [mfTaskSubmit]="save">
        {{ 'public.signUp.submit' | t }}
      </button>
      <p class="switch">
        <span>{{ 'public.signUp.haveAccount' | t }}</span>
        <button type="button" (click)="switchToSignIn()">
          {{ 'public.signUp.signIn' | t }}
        </button>
      </p>
    </form>
  `,
})
export class SignUp {
  private readonly session = inject(Session);
  private readonly i18n = inject(I18n);
  private readonly task = injectOverlayTask<
    AuthData,
    'signed-in' | AuthSwitch
  >();

  protected readonly shown = signal(false);

  protected readonly form = new FormGroup({
    email: new FormControl(this.task.data?.email ?? '', {
      nonNullable: true,
      validators: [Validators.required, Validators.pattern(ADDRESS)],
    }),
    name: new FormControl('', {
      nonNullable: true,
      validators: [nameLength],
    }),
    password: new FormControl('', {
      nonNullable: true,
      validators: [
        Validators.required,
        Validators.minLength(8),
        Validators.maxLength(128),
      ],
    }),
  });

  protected readonly save = taskSave({
    done: () => this.task.close('signed-in'),
    form: this.form,
    messages: 'public.signUp',
    send: async ({ email = '', name = '', password = '' }) => {
      const me = await this.session.signUp(
        name.trim(),
        email.trim(),
        password,
        this.i18n.language(),
      );
      if (!me) throw new Error('signed up without an account');
      return me;
    },
  });

  constructor() {
    void this.i18n.enter('public');
  }

  protected switchToSignIn() {
    this.task.close({
      email: this.form.controls.email.value.trim(),
      switchTo: 'sign-in',
    });
  }
}
