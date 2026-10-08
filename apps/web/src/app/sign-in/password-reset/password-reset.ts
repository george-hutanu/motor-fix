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

import { ADDRESS, type AuthSwitch } from '../sign-in';

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
  styleUrl: './password-reset.css',
  templateUrl: './password-reset.html',
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
