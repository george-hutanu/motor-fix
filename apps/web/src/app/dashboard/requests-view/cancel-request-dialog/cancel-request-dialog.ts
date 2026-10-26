import { HttpErrorResponse } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { FormGroup, ReactiveFormsModule } from '@angular/forms';
import { QuoteRequestsService } from '@motor-fix/data-access';
import { I18n, TranslatePipe } from '@motor-fix/i18n';
import {
  injectOverlayTask,
  type OverlayResult,
  TaskError,
  TaskSubmit,
  taskSave,
  toProblem,
} from '@motor-fix/overlays';
import { HlmButton, toast } from '@motor-fix/ui-cockpit';

import { refusalText } from '../refusal-text';

export interface CancelRequestData {
  requestId: string;
  // The row's car and its jobs (or the description's first line).
  car: string;
  what: string;
}

// Cancelled, or refused because the request moved on meanwhile (booked,
// already closed): the opener re-reads its list.
export type CancelRequestResult = 'done' | 'refused';

const MESSAGES = 'driver.requests.cancelRequestDialog';
// The answers that end the dialog with their message as the toast.
const ENDING = new Set([404, 409]);

// "Anulează cererea": what a cancel does, then the cancel. No reason asked.
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(window:offline)': 'online.set(false)',
    '(window:online)': 'online.set(true)',
  },
  imports: [
    HlmButton,
    ReactiveFormsModule,
    TaskError,
    TaskSubmit,
    TranslatePipe,
  ],
  selector: 'mf-cancel-request-dialog',
  styleUrl: './cancel-request-dialog.css',
  templateUrl: './cancel-request-dialog.html',
})
export class CancelRequestDialog {
  private readonly requests = inject(QuoteRequestsService);
  private readonly i18n = inject(I18n);
  protected readonly task = injectOverlayTask<
    CancelRequestData,
    OverlayResult<CancelRequestResult>
  >();

  protected readonly online = signal(globalThis.navigator?.onLine !== false);
  protected readonly form = new FormGroup({});
  protected readonly subject = [this.task.data.car, this.task.data.what]
    .filter(Boolean)
    .join(' · ');

  protected readonly save = taskSave({
    done: () => {
      toast(this.i18n.t(`${MESSAGES}.toast`));
      this.task.close('done');
    },
    form: this.form,
    messages: MESSAGES,
    send: () =>
      this.requests
        .cancelRequestControllerCancel({ id: this.task.data.requestId })
        .catch((failure: unknown) => {
          this.refused(failure);
          throw failure;
        }),
  });
  protected readonly sending = computed(() => this.save.state() === 'sending');

  protected submit() {
    if (this.online()) this.save.submit();
  }

  // A request that can no longer be cancelled, or is gone, ends the dialog;
  // its message (else the shared one, else the server's) is the toast.
  private refused(failure: unknown) {
    if (!(failure instanceof HttpErrorResponse) || !ENDING.has(failure.status))
      return;
    const { code, detail } = toProblem(failure);
    toast(refusalText(this.i18n, MESSAGES, code) ?? detail ?? code);
    this.task.close('refused');
  }
}
