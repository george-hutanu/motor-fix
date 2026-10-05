import {
  ChangeDetectionStrategy,
  Component,
  effect,
  inject,
  signal,
} from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { AuthService } from '@motor-fix/data-access';
import { I18n, TranslatePipe } from '@motor-fix/i18n';
import {
  FieldError,
  injectOverlayTask,
  TaskError,
  TaskSubmit,
  taskSave,
  toProblem,
} from '@motor-fix/overlays';
import { HlmButton, HlmInput } from '@motor-fix/ui-cockpit';

import type { AuthSwitch } from './sign-in';
import { characters } from './sign-up';
import { Session } from '../dashboard/session';

type State = 'checking' | 'ready' | 'expired' | 'unreachable';

const EXPIRED = new Set(['token_expired', 'token_invalid']);

const expired = (error: unknown) => {
  const { code, status } = toProblem(error);
  return status === 410 && EXPIRED.has(code);
};

// Opened from the reset e-mail's link: the link is checked first, so an old
// one says so before anything is typed. It closes signed in, or with a switch
// to the reset task when a new link is asked for.
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
  selector: 'mf-new-password',
  styles: `
    form, section { display: grid; gap: var(--mf-space-4); }
    h3, p { margin: 0; overflow-wrap: anywhere; }
    p { color: var(--mf-text-secondary); }
    .field { display: grid; gap: var(--mf-space-2); }
    label { font-weight: 700; }
    button { width: 100%; min-height: 54px; white-space: normal; }
  `,
  template: `
    @switch (state()) {
      @case ('checking') {
        <section aria-busy="true">
          <p>{{ 'public.newPassword.checking' | t }}</p>
        </section>
      }
      @case ('expired') {
        <section>
          <h3>{{ 'public.newPassword.expired' | t }}</h3>
          <p>{{ 'public.newPassword.expiredLine' | t }}</p>
          <button hlmBtn type="button" (click)="askAgain()">
            {{ 'public.newPassword.askAgain' | t }}
          </button>
        </section>
      }
      @case ('unreachable') {
        <section>
          <p role="alert">{{ 'shell.form.problem.network' | t }}</p>
          <button hlmBtn variant="secondary" type="button" (click)="check()">
            {{ 'public.newPassword.retry' | t }}
          </button>
        </section>
      }
      @default {
        <form [formGroup]="form" (ngSubmit)="save.submit()" novalidate>
          <div class="field">
            <label for="mf-new-password">{{ 'public.newPassword.password' | t }}</label>
            <input
              hlmInput
              id="mf-new-password"
              type="password"
              autocomplete="new-password"
              formControlName="password"
              aria-describedby="mf-new-password-hint mf-new-password-error"
            />
            <p id="mf-new-password-hint">{{ 'public.newPassword.hint' | t }}</p>
            <mf-field-error id="mf-new-password-error" [save]="save" [control]="form.controls.password" />
          </div>
          <mf-task-error [save]="save" />
          <button hlmBtn type="submit" [mfTaskSubmit]="save">
            {{ 'public.newPassword.submit' | t }}
          </button>
        </form>
      }
    }
  `,
})
export class NewPassword {
  private readonly auth = inject(AuthService);
  private readonly session = inject(Session);
  private readonly task = injectOverlayTask<
    { token: string },
    'signed-in' | AuthSwitch
  >();
  private readonly token = this.task.data?.token ?? '';

  protected readonly state = signal<State>('checking');

  protected readonly form = new FormGroup({
    password: new FormControl('', {
      nonNullable: true,
      validators: [characters(8, 128)],
    }),
  });

  protected readonly save = taskSave({
    done: () => this.task.close('signed-in'),
    form: this.form,
    messages: 'public.signUp',
    send: async ({ password = '' }) => {
      const me = await this.session.resetPassword(this.token, password);
      if (!me) throw new Error('reset without an account');
      return me;
    },
  });

  constructor() {
    void inject(I18n).enter('public');
    // A link that stopped working while the form was open.
    effect(() => {
      const code = this.save.problem()?.code;
      if (code && EXPIRED.has(code)) this.state.set('expired');
    });
    void this.check();
  }

  protected async check() {
    this.state.set('checking');
    try {
      await this.auth.passwordResetControllerCheck({
        body: { token: this.token },
      });
      this.state.set('ready');
    } catch (error) {
      this.state.set(expired(error) ? 'expired' : 'unreachable');
    }
  }

  protected askAgain() {
    this.task.close({ email: '', switchTo: 'reset' });
  }
}
