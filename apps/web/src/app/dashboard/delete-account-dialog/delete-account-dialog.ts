import { Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import {
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { Router } from '@angular/router';
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
import { HlmButton, HlmInput, toast } from '@motor-fix/ui-cockpit';

import { SignInDialog } from '../../sign-in/sign-in-dialog';
import { Live } from '../live';
import { PushDevice } from '../push-device';
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
  private readonly live = inject(Live);
  private readonly push = inject(PushDevice);
  private readonly router = inject(Router);
  private readonly i18n = inject(I18n);
  protected readonly task = injectOverlayTask<undefined, true | 'cancelled'>();

  private readonly me = this.session.current();
  protected readonly label =
    this.me?.email || this.me?.phone
      ? 'shell.deleteAccount.fieldEmailOrPhone'
      : 'shell.deleteAccount.fieldPhrase';

  protected readonly form = new FormGroup({
    confirmation: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required],
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
      try {
        await this.auth.accountDeletionControllerDeleteAccount(params);
      } catch (error) {
        if (toProblem(error).code !== 'reauth_required') throw error;
        if (!(await this.signIn.gate())) throw error;
        await this.auth.accountDeletionControllerDeleteAccount(params);
      }
      // The account and its sessions are gone: nothing is asked of the server
      // any more, which would only answer with a sign-in.
      this.live.close();
      await this.push.dropped();
      this.session.revoked();
      await this.router.navigateByUrl('/');
      toast(this.i18n.t('shell.deleteAccount.done'));
    },
  });
}
