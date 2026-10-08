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

import { characters } from '../../characters';
import { Session } from '../../dashboard/session';
import type { AuthSwitch } from '../sign-in';

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
  styleUrl: './new-password.css',
  templateUrl: './new-password.html',
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
