import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  type ElementRef,
  effect,
  Injector,
  inject,
  viewChild,
} from '@angular/core';
import {
  FormControl,
  FormGroup,
  ReactiveFormsModule,
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

import { Session } from '../dashboard/session';

// Text, "@", and a domain with a dot, spaces around it allowed; the server
// decides the rest.
export const ADDRESS = /^\s*[^\s@]+@[^\s@]+\.[^\s@]+\s*$/;

// What a sign-in or sign-up task closes with to hand over to the other one.
export interface AuthSwitch {
  switchTo: 'sign-in' | 'sign-up' | 'reset' | 'phone';
  email: string;
  phone?: string;
}

// The e-mail and the number typed in the other tasks, if any, and whether an
// action that needs an account opened the dialog.
export type AuthData =
  | { email?: string; phone?: string; reason?: boolean }
  | undefined;

// The sign-in task shown in the shared dialog. It closes with "signed-in", or
// with a switch to sign-up; whoever opened it decides where to go next.
// Saving, field errors and the answer's message are the shared task
// behaviour; the codes only sign-in has are under public.signIn.problem.
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
  selector: 'mf-sign-in',
  styles: `
    form { display: grid; gap: var(--mf-space-4); }
    .brand { margin: 0; color: var(--mf-text-secondary); }
    .field { display: grid; gap: var(--mf-space-2); }
    label { font-weight: 700; }
    .remember-row { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 0 var(--mf-space-3); }
    .remember { display: flex; align-items: center; gap: var(--mf-space-3); min-height: var(--mf-tap); font-weight: 400; cursor: pointer; }
    .remember input { width: 20px; height: 20px; margin: 0; accent-color: var(--mf-amber); }
    button[type='submit'], .phone { width: 100%; min-height: 54px; white-space: normal; }
    .or { display: flex; align-items: center; gap: var(--mf-space-3); margin: 0; color: var(--mf-text-secondary); }
    .or::before, .or::after { content: ''; flex: 1; border-top: 1px solid var(--mf-line); }
    .switch { display: flex; flex-wrap: wrap; align-items: center; justify-content: center; gap: 0 var(--mf-space-2); margin: 0; color: var(--mf-text-secondary); }
    .switch button, .forgot { min-height: var(--mf-tap); padding: 0; border: 0; background: transparent; color: var(--mf-amber-ink); font: inherit; font-weight: 700; cursor: pointer; }
    .switch button:focus-visible, .forgot:focus-visible { outline: 2px solid var(--mf-amber-ink); outline-offset: 2px; }
  `,
  template: `
    <form [formGroup]="form" (ngSubmit)="save.submit()" novalidate>
      <p class="brand">{{ 'public.signIn.brand' | t }}</p>
      @if (reason) {
        <p class="brand">{{ 'public.signIn.reason' | t }}</p>
      }
      <div class="field">
        <label for="mf-sign-in-email">{{ 'public.signIn.email' | t }}</label>
        <input
          hlmInput
          id="mf-sign-in-email"
          type="email"
          inputmode="email"
          autocomplete="email"
          spellcheck="false"
          formControlName="email"
          [placeholder]="'public.signIn.emailPlaceholder' | t"
          aria-describedby="mf-sign-in-email-error"
        />
        <mf-field-error id="mf-sign-in-email-error" [save]="save" [control]="form.controls.email" />
      </div>
      <div class="field">
        <label for="mf-sign-in-password">{{ 'public.signIn.password' | t }}</label>
        <input
          #passwordInput
          hlmInput
          id="mf-sign-in-password"
          type="password"
          autocomplete="current-password"
          formControlName="password"
          [placeholder]="'public.signIn.passwordPlaceholder' | t"
          aria-describedby="mf-sign-in-password-error"
        />
        <mf-field-error id="mf-sign-in-password-error" [save]="save" [control]="form.controls.password" />
      </div>
      <div class="remember-row">
        <label class="remember">
          <input type="checkbox" formControlName="remember" />
          <span>{{ 'public.signIn.remember' | t }}</span>
        </label>
        <button type="button" class="forgot" [disabled]="save.state() === 'sending'" (click)="switchTo('reset')">
          {{ 'public.signIn.forgot' | t }}
        </button>
      </div>
      <mf-task-error [save]="save" />
      <button hlmBtn type="submit" [mfTaskSubmit]="save">
        {{ 'public.signIn.submit' | t }}
      </button>
      <p class="or" aria-hidden="true">{{ 'public.signIn.or' | t }}</p>
      <button hlmBtn variant="secondary" type="button" class="phone" [disabled]="save.state() === 'sending'" (click)="switchTo('phone')">
        {{ 'public.signIn.withPhone' | t }}
      </button>
      <p class="switch">
        <span>{{ 'public.signIn.newHere' | t }}</span>
        <button type="button" [disabled]="save.state() === 'sending'" (click)="switchTo('sign-up')">
          {{ 'public.signIn.createAccount' | t }}
        </button>
      </p>
    </form>
  `,
})
export class SignIn {
  private readonly session = inject(Session);
  private readonly task = injectOverlayTask<
    AuthData,
    'signed-in' | AuthSwitch
  >();
  private readonly passwordInput =
    viewChild.required<ElementRef<HTMLInputElement>>('passwordInput');

  protected readonly reason = this.task.data?.reason === true;

  protected readonly form = new FormGroup({
    email: new FormControl(this.task.data?.email ?? '', {
      nonNullable: true,
      validators: [Validators.required, Validators.pattern(ADDRESS)],
    }),
    password: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required],
    }),
    remember: new FormControl(true, { nonNullable: true }),
  });

  protected readonly save = taskSave({
    done: () => this.task.close('signed-in'),
    form: this.form,
    messages: 'public.signIn',
    send: async ({ email = '', password = '', remember = true }) => {
      const me = await this.session.signIn(email.trim(), password, remember);
      if (!me) throw new Error('signed in without an account');
      return me;
    },
  });

  protected switchTo(task: 'sign-up' | 'reset' | 'phone') {
    const phone = this.task.data?.phone;
    this.task.close({
      email: this.form.controls.email.value.trim(),
      ...(phone && { phone }),
      switchTo: task,
    });
  }

  constructor() {
    void inject(I18n).enter('public');
    const injector = inject(Injector);
    // A wrong pair: the password is typed again, from an empty field.
    effect(() => {
      if (this.save.problem()?.code !== 'invalid_credentials') return;
      this.form.controls.password.reset();
      afterNextRender(() => this.passwordInput().nativeElement.focus(), {
        injector,
      });
    });
  }
}
