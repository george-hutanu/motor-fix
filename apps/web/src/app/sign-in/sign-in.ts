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
const ADDRESS = /^\s*[^\s@]+@[^\s@]+\.[^\s@]+\s*$/;

// The sign-in task shown in the shared dialog. It closes with "signed-in";
// whoever opened it decides where to go next. Saving, field errors and the
// answer's message are the shared task behaviour; the codes only sign-in has
// are under public.signIn.problem.
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
    .remember { display: flex; align-items: center; gap: var(--mf-space-3); min-height: var(--mf-tap); font-weight: 400; cursor: pointer; }
    .remember input { width: 20px; height: 20px; margin: 0; accent-color: var(--mf-amber); }
    button { width: 100%; min-height: 54px; white-space: normal; }
  `,
  template: `
    <form [formGroup]="form" (ngSubmit)="save.submit()" novalidate>
      <p class="brand">{{ 'public.signIn.brand' | t }}</p>
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
      <label class="remember">
        <input type="checkbox" formControlName="remember" />
        <span>{{ 'public.signIn.remember' | t }}</span>
      </label>
      <mf-task-error [save]="save" />
      <button hlmBtn type="submit" [mfTaskSubmit]="save">
        {{ 'public.signIn.submit' | t }}
      </button>
    </form>
  `,
})
export class SignIn {
  private readonly session = inject(Session);
  private readonly task = injectOverlayTask<undefined, 'signed-in'>();
  private readonly passwordInput =
    viewChild.required<ElementRef<HTMLInputElement>>('passwordInput');

  protected readonly form = new FormGroup({
    email: new FormControl('', {
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
