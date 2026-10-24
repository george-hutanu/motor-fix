import { Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { AuthService } from '@motor-fix/data-access';
import { TranslatePipe } from '@motor-fix/i18n';
import {
  FieldError,
  injectOverlayTask,
  TaskError,
  TaskSubmit,
  taskSave,
  toProblem,
} from '@motor-fix/overlays';
import { HlmButton, HlmInput } from '@motor-fix/ui-cockpit';

import { SignInDialog } from '../../sign-in/sign-in-dialog';
import { Session } from '../session';

// "Ștergi contul?": confirmed by typing the account's e-mail or phone, or the
// word for an account with neither. A sign-in older than the server allows is
// renewed over the dialog, and the deletion sent once more.
@Component({
  imports: [
    FieldError,
    HlmButton,
    HlmInput,
    ReactiveFormsModule,
    TaskError,
    TaskSubmit,
    TranslatePipe,
  ],
  selector: 'mf-delete-account-dialog',
  styleUrl: './delete-account-dialog.css',
  templateUrl: './delete-account-dialog.html',
})
export class DeleteAccountDialog {
  private readonly auth = inject(AuthService);
  private readonly session = inject(Session);
  private readonly signIn = inject(SignInDialog);
  protected readonly task = injectOverlayTask<undefined, true | 'cancelled'>();

  private readonly me = this.session.current();
  protected readonly label =
    this.me?.email || this.me?.phone
      ? 'shell.deleteAccount.fieldEmailOrPhone'
      : 'shell.deleteAccount.fieldPhrase';

  protected readonly form = new FormGroup({
    confirmation: new FormControl('', {
      nonNullable: true,
      // Blank counts as empty: Enter in the field must not send it.
      validators: [
        ({ value }) => (value.trim() === '' ? { required: true } : null),
      ],
    }),
  });

  private readonly typed = toSignal(
    this.form.controls.confirmation.valueChanges,
    { initialValue: '' },
  );
  protected readonly filled = computed(() => this.typed().trim() !== '');

  protected readonly save = taskSave({
    done: () => this.task.close(true),
    form: this.form,
    messages: 'shell.deleteAccount',
    send: async ({ confirmation = '' }) => {
      const params = { body: { confirmation: confirmation.trim() } };
      // The session's own: the "sessions ended" word the deletion sends this
      // tab can reach it before the answer does.
      await this.session.deleteAccount(async () => {
        try {
          await this.auth.accountDeletionControllerDeleteAccount(params);
        } catch (error) {
          if (toProblem(error).code !== 'reauth_required') throw error;
          if (!(await this.signIn.gate())) throw error;
          await this.auth.accountDeletionControllerDeleteAccount(params);
        }
      });
      // Setări signs the tab out once this dialog is gone: a way Home started
      // under it would be undone by its step back over its history entry.
    },
  });
}
