import { HttpErrorResponse } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import {
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import {
  DECLINE_REASON_CODES,
  DECLINE_REASON_TEXTS,
  type DeclineReasonCode,
} from '@motor-fix/contracts/request-status';
import { GarageRequestsService } from '@motor-fix/data-access';
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

export interface DeclineRequestData {
  requestId: string;
  // The row's driver and car, named under the title.
  driver: string;
  car: string;
}

// Declined, or refused because the request was answered, closed or taken
// from the garage meanwhile: the opener re-reads its lists.
export type DeclineRequestResult = 'declined' | 'refused';

const MESSAGES = 'garage.requests.decline';
// The answers that end the dialog with their message as the toast.
const ENDING = new Set([403, 404, 409]);

// "Refuză": one of the four reasons, then the decline.
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
  selector: 'mf-decline-request-dialog',
  styleUrl: './decline-request-dialog.css',
  templateUrl: './decline-request-dialog.html',
})
export class DeclineRequestDialog {
  private readonly requests = inject(GarageRequestsService);
  private readonly i18n = inject(I18n);
  protected readonly task = injectOverlayTask<
    DeclineRequestData,
    OverlayResult<DeclineRequestResult>
  >();

  protected readonly online = signal(globalThis.navigator?.onLine !== false);
  protected readonly form = new FormGroup({
    reason: new FormControl<DeclineReasonCode | null>(null, {
      validators: Validators.required,
    }),
  });
  private readonly changed = toSignal(this.form.events);

  protected readonly subject =
    `${this.task.data.driver} · ${this.task.data.car}`;
  protected readonly reasons = computed(() => {
    const language = this.i18n.language();
    return DECLINE_REASON_CODES.map((code) => ({
      code,
      label: DECLINE_REASON_TEXTS[code].label[language],
    }));
  });

  protected readonly save = taskSave({
    done: () => {
      toast(this.i18n.t(`${MESSAGES}.declined`));
      this.task.close('declined');
    },
    form: this.form,
    messages: MESSAGES,
    send: () =>
      this.requests
        .garageRequestsControllerDecline({
          body: { reason: this.form.getRawValue().reason as DeclineReasonCode },
          id: this.task.data.requestId,
        })
        .catch((failure: unknown) => {
          this.refused(failure);
          throw failure;
        }),
  });
  protected readonly sending = computed(() => this.save.state() === 'sending');

  protected blocked() {
    this.changed();
    return !this.online() || this.form.invalid;
  }

  protected submit() {
    if (!this.blocked()) this.save.submit();
  }

  // Another answer, a closed request, a lost permission or a request no
  // longer the garage's ends the dialog; its message is the toast.
  private refused(failure: unknown) {
    if (!(failure instanceof HttpErrorResponse) || !ENDING.has(failure.status))
      return;
    const { code, detail } = toProblem(failure);
    const key = `${MESSAGES}.problem.${code}`;
    const said = this.i18n.t(key);
    toast(said !== key ? said : (detail ?? said));
    this.task.close('refused');
  }
}
