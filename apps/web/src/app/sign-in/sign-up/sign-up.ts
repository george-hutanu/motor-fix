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

import { Session } from '../../dashboard/session';
import { Consent, consentControl } from '../consent/consent';
import { ProviderButtons } from '../providers/providers';
import { ADDRESS, type AuthData, type AuthSwitch } from '../sign-in';

// Between min and max characters, counted in code points as the server counts
// them, so an emoji is one; `trim` checks the value as it will be stored. The
// messages are the shared ones for these validators.
export const characters =
  (min: number, max: number, trim = false) =>
  (control: AbstractControl): ValidationErrors | null => {
    const value = String(control.value ?? '');
    const length = [...(trim ? value.trim() : value)].length;
    if (length === 0) return { required: true };
    if (length < min)
      return { minlength: { actualLength: length, requiredLength: min } };
    if (length > max)
      return { maxlength: { actualLength: length, requiredLength: max } };
    return null;
  };

// The sign-up task shown in the shared dialog: a driver account, signed in at
// once. It closes with "signed-in", or with a switch back to sign-in. The
// server holds the password rule; the length is only checked here first.
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    Consent,
    FieldError,
    HlmButton,
    HlmInput,
    ProviderButtons,
    ReactiveFormsModule,
    TaskError,
    TaskSubmit,
    TranslatePipe,
  ],
  selector: 'mf-sign-up',
  styleUrl: './sign-up.css',
  templateUrl: './sign-up.html',
})
export class SignUp {
  private readonly session = inject(Session);
  private readonly i18n = inject(I18n);
  private readonly task = injectOverlayTask<
    AuthData,
    'signed-in' | AuthSwitch
  >();

  protected readonly shown = signal(false);
  protected readonly returnTo =
    this.task.data?.reason === true ? inject(Router).url : null;

  protected readonly form = new FormGroup({
    consent: consentControl(),
    email: new FormControl(this.task.data?.email ?? '', {
      nonNullable: true,
      validators: [Validators.required, Validators.pattern(ADDRESS)],
    }),
    name: new FormControl(this.task.data?.name ?? '', {
      nonNullable: true,
      validators: [characters(2, 80, true)],
    }),
    password: new FormControl('', {
      nonNullable: true,
      validators: [characters(8, 128)],
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
