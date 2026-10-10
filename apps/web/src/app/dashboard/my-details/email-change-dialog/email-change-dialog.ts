import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import {
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { MeService, type PendingEmailDto } from '@motor-fix/data-access';
import { I18n, TranslatePipe } from '@motor-fix/i18n';
import {
  FieldError,
  injectOverlayTask,
  TaskError,
  TaskSubmit,
  taskSave,
} from '@motor-fix/overlays';
import { HlmButton, HlmInput } from '@motor-fix/ui-cockpit';

import { ADDRESS } from '../../../sign-in/sign-in';

// A new e-mail address: a link goes to it, and the panel shows it pending
// until the link is opened. Closes with the pending address.
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
  selector: 'mf-email-change-dialog',
  styleUrl: './email-change-dialog.css',
  templateUrl: './email-change-dialog.html',
})
export class EmailChangeDialog {
  private readonly api = inject(MeService);
  private readonly task = injectOverlayTask<undefined, PendingEmailDto>();

  protected readonly form = new FormGroup({
    email: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.pattern(ADDRESS)],
    }),
  });

  protected readonly save = taskSave({
    done: (answer: PendingEmailDto) => this.task.close(answer),
    form: this.form,
    messages: 'driver.emailChange',
    send: ({ email = '' }) =>
      this.api.emailChangeControllerRequest({ body: { email: email.trim() } }),
  });

  constructor() {
    void inject(I18n).enter('driver');
  }
}
