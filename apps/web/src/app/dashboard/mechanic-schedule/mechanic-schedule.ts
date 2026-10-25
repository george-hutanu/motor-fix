import { HttpErrorResponse } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  linkedSignal,
  signal,
  untracked,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  type AbstractControl,
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  type ValidatorFn,
} from '@angular/forms';
import {
  clipStretch,
  DAY_OFF_DAYS_AHEAD,
  DAY_OFF_NOTE_MAX,
  type Interval,
  SATURDAY_DEFAULT,
  stretchOf,
  TIMES,
  todayInBucharest,
  WEEKDAYS,
  type Weekday,
  type WeeklyHours,
} from '@motor-fix/contracts/garage-hours';
import {
  type DayOffBookingDto,
  type GarageMechanicDto,
  GaragesService,
  type MechanicDayOffDto,
  type MechanicScheduleDto,
} from '@motor-fix/data-access';
import {
  formatClock,
  formatDay,
  formatDayMonth,
  I18n,
  TranslatePipe,
} from '@motor-fix/i18n';
import {
  TaskError,
  type TaskSave,
  TaskSubmit,
  taskSave,
  toProblem,
} from '@motor-fix/overlays';
import { HlmButton, HlmInput, HlmSwitch, toast } from '@motor-fix/ui-cockpit';
import { merge } from 'rxjs';

import { liveResource } from '../live';

type DayForm = FormGroup<{
  from: FormControl<string>;
  to: FormControl<string>;
  working: FormControl<boolean>;
}>;

// The refusals the API words under a field, by the field they belong to.
const OWN_PROBLEMS = new Set(['bookings_on_days_off', 'day_off_overlap']);

const DAY_MS = 86_400_000;
const addDays = (day: string, days: number) =>
  new Date(Date.parse(`${day}T00:00:00Z`) + days * DAY_MS)
    .toISOString()
    .slice(0, 10);

// Counted in code points, as the server counts them.
const lengthOf = (text: string) => [...text].length;

// A day's bound: the garage's span that day, the whole day while the garage
// has set no hours, none on a day it is closed.
const boundOf = (
  garageHours: WeeklyHours | Record<string, never>,
  day: Weekday,
): Interval | null => {
  if (Object.keys(garageHours).length === 0)
    return [TIMES[0], TIMES.at(-1) ?? ''];
  return stretchOf((garageHours as WeeklyHours)[day] ?? []);
};

// On the closing time, a leaf: the form reveals and words only leaves.
const dayRule =
  (bound: () => Interval | null): ValidatorFn =>
  (control) => {
    const group = control.parent;
    if (!group) return null;
    const { from, to, working } = group.getRawValue() as {
      from: string;
      to: string;
      working: boolean;
    };
    if (!working) return null;
    if (to <= from) return { order: true };
    const span = bound();
    return !span || from < span[0] || to > span[1]
      ? { outside_opening: true }
      : null;
  };

// The bookings on the new days off, one line per Bucharest day.
function bookingDays(bookings: readonly DayOffBookingDto[]) {
  const days = new Map<string, string[]>();
  for (const booking of [...bookings].sort((a, b) =>
    a.startsAt.localeCompare(b.startsAt),
  )) {
    const day = todayInBucharest(new Date(booking.startsAt));
    days.set(day, [...(days.get(day) ?? []), formatClock(booking.startsAt)]);
  }
  return [...days].map(([day, times]) => ({ day, times }));
}

// "Program": the card's working week, Monday to Sunday inside the garage's
// hours, the Saturday switch, and the days off with their booking warning.
// A save answered by the API shows at once; another tab's change arrives on
// the live stream.
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    HlmButton,
    HlmInput,
    HlmSwitch,
    ReactiveFormsModule,
    TaskError,
    TaskSubmit,
    TranslatePipe,
  ],
  selector: 'mf-mechanic-schedule',
  styleUrl: './mechanic-schedule.css',
  templateUrl: './mechanic-schedule.html',
})
export class MechanicSchedule {
  private readonly garages = inject(GaragesService);
  private readonly i18n = inject(I18n);

  readonly garageId = input.required<string>();
  readonly card = input.required<GarageMechanicDto>();

  protected readonly days = WEEKDAYS;
  // Whole keys, so the texts check finds each one.
  protected readonly dayNames: Record<Weekday, string> = {
    fri: 'garage.mechanicSchedule.days.fri',
    mon: 'garage.mechanicSchedule.days.mon',
    sat: 'garage.mechanicSchedule.days.sat',
    sun: 'garage.mechanicSchedule.days.sun',
    thu: 'garage.mechanicSchedule.days.thu',
    tue: 'garage.mechanicSchedule.days.tue',
    wed: 'garage.mechanicSchedule.days.wed',
  };
  protected readonly noteMax = DAY_OFF_NOTE_MAX;

  // The first read starts in the constructor, before the inputs are set: it
  // waits one turn for them.
  protected readonly view = liveResource(
    async () =>
      Promise.resolve().then(() =>
        this.garages.mechanicScheduleControllerRead({
          garageId: this.garageId(),
          mechanicId: this.card().id,
        }),
      ),
    ['mechanic.updated'],
    () => this.card().id,
  );
  // The last read, or the answer of the last save until the next read.
  protected readonly schedule = linkedSignal<MechanicScheduleDto | undefined>(
    () => this.view.value(),
  );
  // The client types a week loosely; the API answers a whole one or none.
  private readonly garageHours = computed(
    () =>
      (this.schedule()?.garageHours ?? {}) as
        | WeeklyHours
        | Record<string, never>,
  );

  protected readonly hoursForm = new FormGroup({
    workingHours: new FormGroup(
      Object.fromEntries(
        WEEKDAYS.map((day) => [
          day,
          new FormGroup({
            from: new FormControl('', { nonNullable: true }),
            to: new FormControl('', {
              nonNullable: true,
              validators: [dayRule(() => this.bound(day))],
            }),
            working: new FormControl(false, { nonNullable: true }),
          }),
        ]),
      ) as Record<Weekday, DayForm>,
    ),
    worksSaturdays: new FormControl(false, {
      nonNullable: true,
      validators: [
        (control) =>
          control.value === true && this.bound('sat') === null
            ? { garage_closed_saturday: true }
            : null,
      ],
    }),
  });

  private readonly today = todayInBucharest();
  protected readonly dayOffForm = new FormGroup({
    firstDay: new FormControl('', {
      nonNullable: true,
      validators: [
        (control) => {
          if (!control.value) return { required: true };
          return control.value < this.today ? { past: true } : null;
        },
      ],
    }),
    lastDay: new FormControl('', {
      nonNullable: true,
      validators: [
        (control: AbstractControl<string>) => {
          const first = control.parent?.get('firstDay')?.value ?? '';
          if (!control.value) return null;
          if (first && control.value < first) return { order: true };
          return control.value > addDays(this.today, DAY_OFF_DAYS_AHEAD)
            ? { too_far: true }
            : null;
        },
      ],
    }),
    note: new FormControl('', {
      nonNullable: true,
      validators: [
        (control) =>
          lengthOf(control.value.trim()) > DAY_OFF_NOTE_MAX
            ? { too_long: true }
            : null,
      ],
    }),
  });

  // The confirmed bookings a new day off would fall on, while asked about.
  protected readonly warning = signal<DayOffBookingDto[] | null>(null);
  private acknowledged = false;
  protected readonly saved = signal(false);

  protected readonly saveHours = taskSave({
    done: (answer) => {
      this.show(answer);
      this.saved.set(true);
    },
    form: this.hoursForm,
    messages: 'garage.mechanicSchedule.hours',
    send: async () => {
      this.saved.set(false);
      try {
        return await this.garages.mechanicScheduleControllerWrite({
          body: this.hoursBody(),
          garageId: this.garageId(),
          mechanicId: this.card().id,
        });
      } catch (error) {
        this.failed(error, 'garage.mechanicSchedule.hours.failed');
        throw error;
      }
    },
  });

  protected readonly addDayOff = taskSave({
    done: (answer) => {
      if (!answer) return;
      this.schedule.set(answer);
      this.dayOffForm.reset();
      toast(this.i18n.t('garage.mechanicSchedule.dayOff.added'));
    },
    form: this.dayOffForm,
    messages: 'garage.mechanicSchedule.dayOff',
    send: async () => {
      const { firstDay, lastDay, note } = this.dayOffForm.getRawValue();
      const acknowledgeBookings = this.acknowledged;
      this.acknowledged = false;
      try {
        return await this.garages.mechanicScheduleControllerAddDayOff({
          body: {
            acknowledgeBookings,
            firstDay,
            lastDay: lastDay || firstDay,
            note: note.trim() || null,
          },
          garageId: this.garageId(),
          mechanicId: this.card().id,
        });
      } catch (error) {
        return this.dayOffRefused(error);
      }
    },
  });

  constructor() {
    void this.i18n.enter('garage');
    // A read fills the week unless the owner is changing it.
    effect(() => {
      const schedule = this.schedule();
      if (schedule) untracked(() => this.fill(schedule));
    });
    const lastDay = this.dayOffForm.controls.lastDay;
    this.dayOffForm.controls.firstDay.valueChanges
      .pipe(takeUntilDestroyed())
      .subscribe(() => lastDay.updateValueAndValidity({ emitEvent: false }));
    this.dayOffForm.valueChanges
      .pipe(takeUntilDestroyed())
      .subscribe(() => this.warning.set(null));
    for (const day of WEEKDAYS) {
      const { from, to, working } = this.dayGroup(day).controls;
      merge(from.valueChanges, working.valueChanges)
        .pipe(takeUntilDestroyed())
        .subscribe(() => to.updateValueAndValidity({ emitEvent: false }));
    }
    this.hoursForm.valueChanges
      .pipe(takeUntilDestroyed())
      .subscribe(() => this.saved.set(false));
  }

  protected bound(day: Weekday): Interval | null {
    return boundOf(this.garageHours(), day);
  }

  // The times a picker offers: the 15-minute grid inside the day's bound.
  protected times(day: Weekday): readonly string[] {
    const bound = this.bound(day);
    if (!bound) return [];
    return TIMES.filter((time) => time >= bound[0] && time <= bound[1]);
  }

  protected dayGroup(day: Weekday): DayForm {
    return this.hoursForm.controls.workingHours.controls[day];
  }

  protected working(day: Weekday): boolean {
    return day === 'sat'
      ? this.hoursForm.controls.worksSaturdays.value
      : this.dayGroup(day).controls.working.value;
  }

  // Ticking a day on starts it at the garage's span; off clears it.
  protected toggle(day: Weekday) {
    const group = this.dayGroup(day);
    const working = !group.controls.working.value;
    const bound = this.bound(day);
    group.setValue({
      from: working && bound ? bound[0] : '',
      to: working && bound ? bound[1] : '',
      working,
    });
  }

  // Turning Saturdays on fills 09:00-14:00 inside the garage's Saturday, or
  // the whole of it when the two do not meet.
  protected saturdays(on: boolean) {
    this.hoursForm.controls.worksSaturdays.setValue(on);
    if (!on) return;
    const bound = this.bound('sat');
    const fill = clipStretch(SATURDAY_DEFAULT, bound) ?? bound;
    if (fill) {
      this.dayGroup('sat').setValue({
        from: fill[0],
        to: fill[1],
        working: true,
      });
    }
  }

  // The API's refusal lands on the day; the form's own on its closing time.
  protected dayProblem(day: Weekday): string {
    const group = this.dayGroup(day);
    return (
      this.problem(group, this.saveHours) ||
      this.problem(group.controls.to, this.saveHours)
    );
  }

  // A revealed refusal in this tab's own words: the API's code, else the
  // rule's.
  protected problem(
    control: AbstractControl,
    save: TaskSave<unknown> = this.addDayOff,
  ): string {
    const errors = control.errors;
    if (!errors || save.fieldError(control) === null) return '';
    const server = errors['server'];
    const code = typeof server === 'string' ? server : Object.keys(errors)[0];
    const messages =
      save === this.saveHours
        ? 'garage.mechanicSchedule.hours'
        : 'garage.mechanicSchedule.dayOff';
    return this.i18n.t(`${messages}.field.${code}`);
  }

  protected range(dayOff: MechanicDayOffDto): string {
    const language = this.i18n.language();
    if (dayOff.firstDay === dayOff.lastDay)
      return formatDay(dayOff.firstDay, language);
    // "12 – 16 mai 2027": the first day says only what the last does not.
    const sameMonth =
      dayOff.firstDay.slice(0, 7) === dayOff.lastDay.slice(0, 7);
    const sameYear = dayOff.firstDay.slice(0, 4) === dayOff.lastDay.slice(0, 4);
    const first = sameMonth
      ? String(Number(dayOff.firstDay.slice(8, 10)))
      : sameYear
        ? formatDayMonth(dayOff.firstDay, language)
        : formatDay(dayOff.firstDay, language);
    return `${first} – ${formatDay(dayOff.lastDay, language)}`;
  }

  protected warningLines(bookings: readonly DayOffBookingDto[]): string[] {
    const language = this.i18n.language();
    return bookingDays(bookings).map(({ day, times }) =>
      this.i18n.t('garage.mechanicSchedule.warning.bookings', {
        count: times.length,
        day: formatDay(day, language),
        times: times.join(', '),
      }),
    );
  }

  protected addAnyway() {
    this.acknowledged = true;
    this.warning.set(null);
    this.addDayOff.submit();
  }

  protected async removeDayOff(dayOff: MechanicDayOffDto) {
    try {
      await this.garages.mechanicScheduleControllerRemoveDayOff({
        dayOffId: dayOff.id,
        garageId: this.garageId(),
        mechanicId: this.card().id,
      });
      this.schedule.update(
        (schedule) =>
          schedule && {
            ...schedule,
            daysOff: schedule.daysOff.filter((d) => d.id !== dayOff.id),
          },
      );
      this.view.reload();
    } catch {
      toast(this.i18n.t('garage.mechanicSchedule.daysOff.removeFailed'));
    }
  }

  private show(answer: MechanicScheduleDto) {
    this.hoursForm.markAsPristine();
    this.schedule.set(answer);
  }

  private fill(schedule: MechanicScheduleDto) {
    if (this.hoursForm.dirty) return;
    for (const day of WEEKDAYS) {
      const stretch = schedule.workingHours[day]?.[0];
      this.dayGroup(day).setValue(
        {
          from: stretch?.[0] ?? '',
          to: stretch?.[1] ?? '',
          working: !!stretch,
        },
        { emitEvent: false },
      );
    }
    this.hoursForm.controls.worksSaturdays.setValue(schedule.worksSaturdays, {
      emitEvent: false,
    });
    this.hoursForm.updateValueAndValidity({ emitEvent: false });
  }

  // Every day as one stretch or none; a day the garage is closed is none.
  private hoursBody() {
    const value = this.hoursForm.getRawValue();
    const saturdays = value.worksSaturdays;
    return {
      workingHours: Object.fromEntries(
        WEEKDAYS.map((day) => {
          const { from, to, working } = value.workingHours[day];
          const kept = day === 'sat' ? saturdays || working : working;
          return [day, kept && this.bound(day) ? [[from, to]] : []];
        }),
      ) as WeeklyHours,
      worksSaturdays: saturdays,
    };
  }

  // The bookings warning waits for the owner's answer; an overlap is shown
  // under the first day. Anything else fails the save.
  private dayOffRefused(error: unknown): null {
    const problem = toProblem(error);
    if (
      problem.code === 'bookings_on_days_off' &&
      error instanceof HttpErrorResponse
    ) {
      this.warning.set(
        (error.error as { bookings?: DayOffBookingDto[] })?.bookings ?? [],
      );
      return null;
    }
    if (problem.code === 'day_off_overlap') {
      throw new HttpErrorResponse({
        error: {
          code: 'day_off_overlap',
          errors: [{ code: 'day_off_overlap', field: 'firstDay' }],
        },
        status: 409,
      });
    }
    this.failed(error, 'garage.mechanicSchedule.dayOff.failed');
    throw error;
  }

  private failed(error: unknown, key: string) {
    const problem = toProblem(error);
    if (problem.errors?.length || OWN_PROBLEMS.has(problem.code)) return;
    toast(this.i18n.t(key));
  }
}
