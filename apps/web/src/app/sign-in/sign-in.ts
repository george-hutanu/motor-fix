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
import { Router } from '@angular/router';
import { I18n, TranslatePipe } from '@motor-fix/i18n';
import {
  FieldError,
  injectOverlayTask,
  TaskError,
  TaskSubmit,
  taskSave,
} from '@motor-fix/overlays';
import { HlmButton, HlmInput } from '@motor-fix/ui-cockpit';

import { PROVIDER_NAME, ProviderButtons } from './providers/providers';
import { type Provider, Session } from '../dashboard/session';

// Text, "@", and a domain with a dot, spaces around it allowed; the server
// decides the rest.
export const ADDRESS = /^\s*[^\s@]+@[^\s@]+\.[^\s@]+\s*$/;

// What a sign-in or sign-up task closes with to hand over to the other one.
export interface AuthSwitch {
  switchTo: 'sign-in' | 'sign-up' | 'reset' | 'phone';
  email: string;
  phone?: string;
}

// Why a provider's sign-in gave no session, shown when the dialog reopens.
export type ProviderProblem =
  | 'failed'
  | 'maintenance'
  | 'suspended'
  | 'email_taken';

const RETURNED: Record<ProviderProblem, string> = {
  email_taken: 'public.signIn.returned.email_taken',
  failed: 'public.signIn.returned.failed',
  maintenance: 'public.signIn.returned.maintenance',
  suspended: 'public.signIn.returned.suspended',
};

// The e-mail and the number typed in the other tasks, if any, the name an
// invite link brings to sign-up, whether an action that needs an account
// opened the dialog, and what went wrong with a provider.
export type AuthData =
  | {
      email?: string;
      name?: string;
      phone?: string;
      reason?: boolean;
      problem?: { code: ProviderProblem; provider: Provider };
    }
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
    ProviderButtons,
    ReactiveFormsModule,
    TaskError,
    TaskSubmit,
    TranslatePipe,
  ],
  selector: 'mf-sign-in',
  styleUrl: './sign-in.css',
  templateUrl: './sign-in.html',
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
  // The screen whose action asked for the sign-in, to come back to after a
  // provider.
  protected readonly returnTo = this.reason ? inject(Router).url : null;
  protected readonly problem = this.shownProblem();

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

  private shownProblem() {
    const problem = this.task.data?.problem;
    return problem
      ? {
          key: RETURNED[problem.code] ?? RETURNED.failed,
          provider: PROVIDER_NAME[problem.provider],
        }
      : null;
  }

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
