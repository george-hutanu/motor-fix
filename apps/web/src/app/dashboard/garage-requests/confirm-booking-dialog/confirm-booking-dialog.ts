import { HttpErrorResponse } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import {
  BookingsService,
  type ConfirmBookingDto,
  type ConfirmOptionsDto,
  type GarageRequestSummaryDto,
} from '@motor-fix/data-access';
import { formatSlot, I18n, TranslatePipe, timeLeft } from '@motor-fix/i18n';
import {
  injectOverlayTask,
  type OverlayResult,
  toProblem,
} from '@motor-fix/overlays';
import { HlmButton, HlmInput, toast } from '@motor-fix/ui-cockpit';

export interface ConfirmBookingData {
  row: GarageRequestSummaryDto;
}

export type ConfirmBookingResult = 'confirmed';

type Field = 'mechanic' | 'lift';

const MESSAGES = 'garage.quotes.confirm';
// The refusals that belong under one select; any other shows at the top.
const FIELD_OF: Record<string, Field> = {
  lift_busy: 'lift',
  mechanic_busy: 'mechanic',
  mechanic_unavailable: 'mechanic',
};

// "Confirmă programarea": the booking named under the title, then the
// mechanic and the lift the garage offers, then the confirmation. A refusal
// keeps the choices and says what to change, under the select it concerns.
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [HlmButton, HlmInput, TranslatePipe],
  selector: 'mf-confirm-booking-dialog',
  styleUrl: './confirm-booking-dialog.css',
  templateUrl: './confirm-booking-dialog.html',
})
export class ConfirmBookingDialog {
  private readonly bookings = inject(BookingsService);
  private readonly i18n = inject(I18n);
  protected readonly task = injectOverlayTask<
    ConfirmBookingData,
    OverlayResult<ConfirmBookingResult>
  >();

  protected readonly row = this.task.data.row;
  protected readonly booking = this.row.booking as NonNullable<
    GarageRequestSummaryDto['booking']
  >;
  protected readonly offered = signal<ConfirmOptionsDto | null>(null);
  protected readonly lifts = computed(() =>
    Array.from({ length: this.offered()?.liftCount ?? 0 }, (_, i) => i + 1),
  );
  protected readonly mechanic = signal('');
  protected readonly lift = signal('');
  protected readonly sending = signal(false);
  protected readonly problem = signal<string | null>(null);
  protected readonly fieldProblem = signal<{
    field: Field;
    text: string;
  } | null>(null);

  protected readonly car =
    `${this.row.car.brand} ${this.row.car.model} · ${this.row.car.year}`;
  protected readonly left = computed(() =>
    timeLeft(this.booking.confirmBy, this.i18n.language(), new Date()),
  );
  protected readonly slot = computed(() =>
    formatSlot(this.booking.startsAt, this.i18n.language(), new Date()),
  );
  protected readonly jobs = computed(() => {
    const included = new Set(
      this.row.quote?.jobs
        .filter((job) => job.included)
        .map((job) => job.requestJobId),
    );
    const english = this.i18n.language() === 'en';
    return this.row.jobs
      .filter((job) => included.has(job.id))
      .map((job) => (english ? job.nameEn : job.nameRo))
      .join(' · ');
  });

  constructor() {
    this.bookings
      .confirmControllerOptions({ id: this.booking.id })
      .then((offered) => {
        this.offered.set(offered);
        this.task.focusStart();
      })
      .catch((failure: unknown) => this.problem.set(this.topText(failure)));
  }

  protected readonly mechanicMessage = computed(() =>
    this.messageFor('mechanic'),
  );
  protected readonly liftMessage = computed(() => this.messageFor('lift'));

  protected pickMechanic(value: string) {
    this.pick('mechanic', value);
  }

  protected pickLift(value: string) {
    this.pick('lift', value);
  }

  private messageFor(field: Field) {
    const said = this.fieldProblem();
    return said?.field === field ? said.text : '';
  }

  private pick(field: Field, value: string) {
    (field === 'mechanic' ? this.mechanic : this.lift).set(value);
    if (this.fieldProblem()?.field === field) this.fieldProblem.set(null);
  }

  protected submit(event: Event) {
    event.preventDefault();
    const offered = this.offered();
    if (!offered || this.sending()) return;
    if (offered.mechanics.length && !this.mechanic()) {
      this.fieldProblem.set({
        field: 'mechanic',
        text: this.i18n.t(`${MESSAGES}.mechanicRequired`),
      });
      document.getElementById('mf-confirm-mechanic')?.focus();
      return;
    }
    const body: ConfirmBookingDto = {
      ...(this.mechanic() && { mechanicId: this.mechanic() }),
      ...(this.lift() && { lift: Number(this.lift()) }),
    };
    this.sending.set(true);
    this.problem.set(null);
    this.bookings
      .confirmControllerConfirm({ body, id: this.booking.id })
      .then(() => {
        this.task.markUnchanged();
        toast(this.i18n.t(`${MESSAGES}.done`));
        this.task.close('confirmed');
      })
      .catch((failure: unknown) => this.refused(failure))
      .finally(() => this.sending.set(false));
  }

  private refused(failure: unknown) {
    const { code } = toProblem(failure);
    const field = FIELD_OF[code];
    if (field && (field === 'lift' ? this.lift() : this.mechanic())) {
      this.fieldProblem.set({ field, text: this.fieldText(code) });
      document.getElementById(`mf-confirm-${field}`)?.focus();
      return;
    }
    this.problem.set(this.topText(failure));
  }

  private fieldText(code: string) {
    const name =
      this.offered()?.mechanics.find((m) => m.id === this.mechanic())?.name ??
      '';
    return this.i18n.t(`${MESSAGES}.problem.${code}`, {
      lift: this.lift(),
      name,
    });
  }

  // A refused transition names the booking's state; any other code its own
  // text, else the shared one.
  private topText(failure: unknown) {
    const { code } = toProblem(failure);
    const state =
      failure instanceof HttpErrorResponse
        ? (failure.error as { currentStatus?: unknown } | null)?.currentStatus
        : undefined;
    const keys = [
      ...(code === 'invalid_transition' && typeof state === 'string'
        ? [`${MESSAGES}.problem.${code}.${state}`]
        : []),
      `${MESSAGES}.problem.${code}`,
      `shell.form.problem.${code}`,
    ];
    for (const key of keys) {
      const said = this.i18n.t(key);
      if (said !== key && typeof said === 'string') return said;
    }
    return this.i18n.t('shell.form.problem.error');
  }
}
