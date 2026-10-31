import { HttpErrorResponse } from '@angular/common/http';
import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  Injector,
  inject,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
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

import { Session } from '../../session';

export interface ConfirmBookingData {
  row: GarageRequestSummaryDto;
}

// Refused: the booking was confirmed, lapsed or cancelled meanwhile.
export type ConfirmBookingResult = 'confirmed' | 'refused';

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
// The lift choice is '' while none is made, '0' for "Fără elevator", else
// the lift's number: a job done on a lift opens with none made.
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [HlmButton, HlmInput, RouterLink, TranslatePipe],
  selector: 'mf-confirm-booking-dialog',
  styleUrl: './confirm-booking-dialog.css',
  templateUrl: './confirm-booking-dialog.html',
})
export class ConfirmBookingDialog {
  private readonly bookings = inject(BookingsService);
  private readonly i18n = inject(I18n);
  private readonly session = inject(Session);
  private readonly injector = inject(Injector);
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
  // The team is on but has no mechanic yet: nothing can be confirmed until
  // one is added on the team page.
  protected readonly noMechanics = computed(() => {
    const offered = this.offered();
    return !!offered?.mechanicRequired && !offered.mechanics.length;
  });
  // Only who may open the team page is sent there.
  protected readonly teamLink = computed(
    () => !!this.session.shown()?.capabilities.includes('garage.team'),
  );
  protected readonly mechanic = signal('');
  protected readonly lift = signal('');
  protected readonly sending = signal(false);
  private readonly reading = signal(false);
  protected readonly busy = computed(() => this.sending() || this.reading());
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
    this.reread().then((offered) => offered && this.task.focusStart());
  }

  private readOptions() {
    this.reading.set(true);
    return this.bookings
      .confirmControllerOptions({ id: this.booking.id })
      .then((offered) => {
        this.offered.set(offered);
        return offered;
      })
      .catch((failure: unknown) => {
        this.problem.set(this.topText(failure));
        return null;
      })
      .finally(() => this.reading.set(false));
  }

  // Reads the choices (at opening, and again when the place was taken
  // meanwhile): a pick still offered stays picked.
  private async reread() {
    const offered = await this.readOptions();
    if (!offered) return null;
    if (!offered.mechanics.some((one) => one.id === this.mechanic())) {
      this.mechanic.set('');
    }
    const lift = Number(this.lift());
    if (this.lift() === '' || lift > offered.liftCount) {
      this.lift.set(offered.needsLift ? '' : '0');
    }
    return offered;
  }

  protected readonly mechanicMessage = computed(() =>
    this.messageFor('mechanic'),
  );
  protected readonly liftMessage = computed(() => this.messageFor('lift'));

  private messageFor(field: Field) {
    const said = this.fieldProblem();
    return said?.field === field ? said.text : '';
  }

  protected pick(field: Field, value: string) {
    (field === 'mechanic' ? this.mechanic : this.lift).set(value);
    if (this.fieldProblem()?.field === field) this.fieldProblem.set(null);
  }

  protected submit(event: Event) {
    event.preventDefault();
    const offered = this.offered();
    if (!offered || this.busy() || this.noMechanics()) return;
    if (offered.mechanicRequired && !this.mechanic()) {
      this.fieldProblem.set({
        field: 'mechanic',
        text: this.i18n.t(`${MESSAGES}.mechanicRequired`),
      });
      document.getElementById('mf-confirm-mechanic')?.focus();
      return;
    }
    if (offered.liftCount && !this.lift()) {
      this.fieldProblem.set({
        field: 'lift',
        text: this.i18n.t(`${MESSAGES}.liftRequired`),
      });
      document.getElementById('mf-confirm-lift')?.focus();
      return;
    }
    const lift = offered.liftCount ? Number(this.lift()) : 0;
    const body: ConfirmBookingDto = {
      ...(offered.mechanicRequired &&
        this.mechanic() && { mechanicId: this.mechanic() }),
      ...(lift > 0 && { lift }),
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
    if (field && (field === 'lift' ? Number(this.lift()) : this.mechanic())) {
      this.fieldProblem.set({ field, text: this.fieldText(code) });
      // The selects are disabled while the confirm is in flight, and a
      // disabled select takes no focus: enabled first, focused once drawn.
      this.sending.set(false);
      afterNextRender(
        () => document.getElementById(`mf-confirm-${field}`)?.focus(),
        { injector: this.injector },
      );
      return;
    }
    // Confirmed, lapsed or cancelled meanwhile: the message is the toast and
    // the panel closes for the lists to re-read.
    if (code === 'invalid_transition') {
      this.task.markUnchanged();
      toast(this.topText(failure));
      this.task.close('refused');
      return;
    }
    this.problem.set(this.topText(failure));
    if (code === 'slot_taken') void this.reread();
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
