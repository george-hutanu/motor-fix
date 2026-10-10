import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
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

import { characters } from '../../../characters';
import { Session } from '../../session';

export type PasswordChangeAnswer = 'changed' | 'sign-in';

// A new password, proven by the current one; an account with none sets its
// first. Closes with "changed", or with "sign-in" when setting one needs a
// fresh sign-in first.
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
  selector: 'mf-password-change-dialog',
  styleUrl: './password-change-dialog.css',
  templateUrl: './password-change-dialog.html',
})
export class PasswordChangeDialog {
  private readonly session = inject(Session);
  private readonly task = injectOverlayTask<
    { hasPassword: boolean },
    PasswordChangeAnswer
  >();
  protected readonly hasPassword = this.task.data?.hasPassword ?? true;

  protected readonly form = new FormGroup({
    currentPassword: new FormControl('', {
      nonNullable: true,
      validators: this.hasPassword ? [Validators.required] : [],
    }),
    newPassword: new FormControl('', {
      nonNullable: true,
      validators: [characters(8, 128)],
    }),
  });

  protected readonly save = taskSave({
    done: () => this.task.close('changed'),
    form: this.form,
    messages: 'driver.passwordChange',
    // Sent as typed: a password's spaces are part of it.
    send: ({ currentPassword = '', newPassword = '' }) =>
      this.session.changePassword(
        this.hasPassword ? { currentPassword, newPassword } : { newPassword },
      ),
  });

  constructor() {
    void inject(I18n).enter('driver');
  }

  protected signInAgain() {
    this.task.close('sign-in');
  }
}
