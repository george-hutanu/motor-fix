import { isPlatformBrowser } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  inject,
  PLATFORM_ID,
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
  BOOKING_CANCEL_NOTE_MAX,
  CANCEL_REASON_TEXTS,
  DRIVER_CANCEL_REASONS,
  type DriverCancelReasonCode,
  FREE_CANCEL_CUTOFF_HOURS,
} from '@motor-fix/contracts/request-status';
import { BookingsService } from '@motor-fix/data-access';
import { formatSlot, I18n, TranslatePipe } from '@motor-fix/i18n';
import {
  injectOverlayTask,
  type OverlayResult,
  TaskError,
  TaskSubmit,
  taskSave,
  toProblem,
} from '@motor-fix/overlays';
import { HlmButton, HlmInput, toast } from '@motor-fix/ui-cockpit';

import { refusalText } from '../refusal-text';

export interface CancelBookingData {
  bookingId: string;
  // The garage's name and the booking's start, named under the title.
  garage: string;
  startsAt: string;
}

// Cancelled, or refused because the booking moved on meanwhile (started,
// confirmed away, already cancelled): the opener re-reads its list.
export type CancelBookingResult = 'done' | 'refused';

const MESSAGES = 'driver.requests.cancelBookingDialog';
// The answers that end the dialog with their message as the toast.
const ENDING = new Set([404, 409]);
const TICK_MS = 60_000;
const CUTOFF_MS = FREE_CANCEL_CUTOFF_HOURS * 3_600_000;

// "Anulează programarea": one of the driver's four reasons and optional
// details, warned when it is late, then the cancel.
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(window:offline)': 'online.set(false)',
    '(window:online)': 'online.set(true)',
  },
  imports: [
    HlmButton,
    HlmInput,
    ReactiveFormsModule,
    TaskError,
    TaskSubmit,
    TranslatePipe,
  ],
  selector: 'mf-cancel-booking-dialog',
  styleUrl: './cancel-booking-dialog.css',
  templateUrl: './cancel-booking-dialog.html',
})
export class CancelBookingDialog {
  private readonly bookings = inject(BookingsService);
  private readonly i18n = inject(I18n);
  protected readonly task = injectOverlayTask<
    CancelBookingData,
    OverlayResult<CancelBookingResult>
  >();

  protected readonly max = BOOKING_CANCEL_NOTE_MAX;
  protected readonly online = signal(globalThis.navigator?.onLine !== false);
  private readonly now = signal(new Date());
  protected readonly form = new FormGroup({
    note: new FormControl('', {
      nonNullable: true,
      validators: Validators.maxLength(BOOKING_CANCEL_NOTE_MAX),
    }),
    reason: new FormControl<DriverCancelReasonCode | null>(null, {
      validators: Validators.required,
    }),
  });
  private readonly changed = toSignal(this.form.events);
  private readonly note = toSignal(this.form.controls.note.valueChanges, {
    initialValue: '',
  });
  protected readonly count = computed(() => this.note().length);

  protected readonly subject = computed(
    () =>
      `${this.task.data.garage} · ${formatSlot(this.task.data.startsAt, this.i18n.language(), this.now())}`,
  );
  // Inside the free window's last two hours the cancel counts as late; the
  // minute tick moves a dialog left open across the line.
  protected readonly late = computed(
    () =>
      this.now().getTime() >
      new Date(this.task.data.startsAt).getTime() - CUTOFF_MS,
  );
  protected readonly reasons = computed(() => {
    const language = this.i18n.language();
    return DRIVER_CANCEL_REASONS.map((code) => ({
      code,
      label: CANCEL_REASON_TEXTS[code].label[language],
    }));
  });

  protected readonly save = taskSave({
    done: () => {
      toast(this.i18n.t(`${MESSAGES}.toast`));
      this.task.close('done');
    },
    form: this.form,
    messages: MESSAGES,
    send: () => {
      const { note, reason } = this.form.getRawValue();
      const trimmed = note.trim();
      return this.bookings
        .cancelBookingControllerCancel({
          body: {
            reason: reason as DriverCancelReasonCode,
            ...(trimmed && { note: trimmed }),
          },
          id: this.task.data.bookingId,
        })
        .catch((failure: unknown) => {
          this.refused(failure);
          throw failure;
        });
    },
  });
  protected readonly sending = computed(() => this.save.state() === 'sending');

  constructor() {
    if (!isPlatformBrowser(inject(PLATFORM_ID))) return;
    const tick = setInterval(() => this.now.set(new Date()), TICK_MS);
    inject(DestroyRef).onDestroy(() => clearInterval(tick));
  }

  protected blocked() {
    this.changed();
    return !this.online() || this.form.invalid;
  }

  protected submit() {
    if (!this.blocked()) this.save.submit();
  }

  // A booking that can no longer be cancelled, or is gone, ends the dialog;
  // its message (else the shared one, else the server's) is the toast.
  private refused(failure: unknown) {
    if (!(failure instanceof HttpErrorResponse) || !ENDING.has(failure.status))
      return;
    const { code, detail } = toProblem(failure);
    toast(refusalText(this.i18n, MESSAGES, code) ?? detail ?? code);
    this.task.close('refused');
  }
}
