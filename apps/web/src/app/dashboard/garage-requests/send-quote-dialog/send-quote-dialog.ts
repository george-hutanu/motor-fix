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
  type AbstractControl,
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  type ValidationErrors,
  Validators,
} from '@angular/forms';
import { todayInBucharest } from '@motor-fix/contracts/garage-hours';
import { baniToLei } from '@motor-fix/contracts/price-range';
import {
  QUOTE_DURATION_MAX_MINUTES,
  QUOTE_DURATION_MIN_MINUTES,
  QUOTE_LEI_MAX,
  QUOTE_LEI_MIN,
  QUOTE_NOTE_MAX,
} from '@motor-fix/contracts/quote-limits';
import {
  type GarageRequestDto,
  GarageRequestsService,
  QuotesService,
  type SendQuoteDto,
} from '@motor-fix/data-access';
import { I18n, TranslatePipe } from '@motor-fix/i18n';
import {
  injectOverlayTask,
  type OverlayResult,
  TaskError,
  TaskSubmit,
  taskSave,
  toProblem,
} from '@motor-fix/overlays';
import { HlmButton, HlmInput, toast } from '@motor-fix/ui-cockpit';

export interface SendQuoteData {
  requestId: string;
}

// Sent, or refused because the request was answered or closed meanwhile: the
// opener re-reads its lists.
export type SendQuoteResult = 'sent' | 'refused';

const MESSAGES = 'garage.quotes.send';
// The slot picker's grid; the duration's is the quote's shortest duration.
const SLOT_STEP_MINUTES = 15;
const WIDE_FACTOR = 3;
const SUBJECT_MAX = 60;

// The order a field's errors are told in, first one wins.
const CODES = [
  'server',
  'required',
  'price_whole',
  'price_min',
  'price_max',
  'duration_step',
  'duration_min',
  'duration_max',
  'slot_step',
  'past',
  'maxlength',
];

const price = (c: AbstractControl): ValidationErrors | null => {
  const lei = c.value as number | null;
  if (lei === null || Number.isNaN(lei)) return { required: true };
  if (!Number.isInteger(lei)) return { price_whole: true };
  if (lei < QUOTE_LEI_MIN) return { price_min: true };
  return lei > QUOTE_LEI_MAX ? { price_max: true } : null;
};

const duration = (g: AbstractControl): ValidationErrors | null => {
  const { hours, minutes } = g.value as {
    hours: number | null;
    minutes: string;
  };
  if (hours === null || Number.isNaN(hours)) return { required: true };
  const total = hours * 60 + Number(minutes);
  if (!Number.isInteger(hours) || total % QUOTE_DURATION_MIN_MINUTES !== 0)
    return { duration_step: true };
  if (total < QUOTE_DURATION_MIN_MINUTES) return { duration_min: true };
  return total > QUOTE_DURATION_MAX_MINUTES ? { duration_max: true } : null;
};

const slot = (g: AbstractControl): ValidationErrors | null => {
  const { day, time } = g.value as { day: string; time: string };
  if (!day || !time) return { required: true };
  if (Number(time.slice(3, 5)) % SLOT_STEP_MINUTES !== 0)
    return { slot_step: true };
  return Date.parse(bucharestInstant(day, time)) <= Date.now()
    ? { past: true }
    : null;
};

const ordered = (g: AbstractControl): ValidationErrors | null => {
  const { fromLei, toLei } = g.value as {
    fromLei: number | null;
    toLei: number | null;
  };
  return fromLei !== null && toLei !== null && fromLei > toLei
    ? { low_above_high: true }
    : null;
};

// Bucharest's offset from UTC at an instant, in minutes.
function offsetAt(at: number): number {
  const name =
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'Europe/Bucharest',
      timeZoneName: 'longOffset',
    })
      .formatToParts(new Date(at))
      .find((part) => part.type === 'timeZoneName')?.value ?? 'GMT';
  const [, sign, hh, mm] = /GMT([+-])(\d{2}):(\d{2})/.exec(name) ?? [];
  if (!sign) return 0;
  return (sign === '-' ? -1 : 1) * (Number(hh) * 60 + Number(mm));
}

// A Bucharest wall-clock day and time as ISO 8601 with its offset.
function bucharestInstant(day: string, time: string): string {
  const wall = Date.parse(`${day}T${time}:00Z`);
  const offset = offsetAt(wall - offsetAt(wall) * 60_000);
  const sign = offset < 0 ? '-' : '+';
  const abs = Math.abs(offset);
  const hh = String(Math.floor(abs / 60)).padStart(2, '0');
  const mm = String(abs % 60).padStart(2, '0');
  return `${day}T${time}:00${sign}${hh}:${mm}`;
}

// The next quarter hour on Bucharest's clock, "HH:MM".
function nextQuarter(): string {
  const [hh, mm] = new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    hourCycle: 'h23',
    minute: '2-digit',
    timeZone: 'Europe/Bucharest',
  })
    .format(new Date())
    .split(':')
    .map(Number);
  const next = Math.min(
    Math.ceil((hh * 60 + mm + 1) / SLOT_STEP_MINUTES) * SLOT_STEP_MINUTES,
    24 * 60 - SLOT_STEP_MINUTES,
  );
  return `${String(Math.floor(next / 60)).padStart(2, '0')}:${String(next % 60).padStart(2, '0')}`;
}

// "Trimite oferta": a price range in lei, the job's duration, the first free
// slot and a note, pre-filled from the garage's price list for the request's
// included jobs.
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
  selector: 'mf-send-quote-dialog',
  styleUrl: './send-quote-dialog.css',
  templateUrl: './send-quote-dialog.html',
})
export class SendQuoteDialog {
  private readonly requests = inject(GarageRequestsService);
  private readonly quotes = inject(QuotesService);
  private readonly i18n = inject(I18n);
  protected readonly task = injectOverlayTask<
    SendQuoteData,
    OverlayResult<SendQuoteResult>
  >();

  protected readonly noteMax = QUOTE_NOTE_MAX;
  protected readonly today = todayInBucharest();
  protected readonly online = signal(globalThis.navigator?.onLine !== false);
  protected readonly request = signal<GarageRequestDto | null>(null);
  protected readonly failed = signal(false);

  protected readonly form = new FormGroup(
    {
      durationMinutes: new FormGroup(
        {
          hours: new FormControl<number | null>(null),
          minutes: new FormControl('0', { nonNullable: true }),
        },
        { validators: duration },
      ),
      fromLei: new FormControl<number | null>(null, { validators: price }),
      note: new FormControl('', {
        nonNullable: true,
        validators: Validators.maxLength(QUOTE_NOTE_MAX),
      }),
      slot: new FormGroup(
        {
          day: new FormControl('', { nonNullable: true }),
          time: new FormControl('', { nonNullable: true }),
        },
        { validators: slot },
      ),
      toLei: new FormControl<number | null>(null, { validators: price }),
    },
    { validators: ordered },
  );
  protected readonly duration = this.form.controls.durationMinutes;
  protected readonly slot = this.form.controls.slot;

  private readonly changed = toSignal(this.form.events);

  protected readonly save = taskSave({
    done: () => {
      toast(this.i18n.t(`${MESSAGES}.sent`));
      this.task.close('sent');
    },
    form: this.form,
    messages: MESSAGES,
    send: (_, key) =>
      this.quotes
        .quotesControllerSend({ body: this.body(), 'Idempotency-Key': key })
        .catch((failure: unknown) => {
          this.refused(failure);
          throw failure;
        }),
  });
  protected readonly sending = computed(() => this.save.state() === 'sending');

  protected readonly subject = computed(() => {
    const request = this.request();
    if (!request) return '';
    const english = this.i18n.language() === 'en';
    const offered = request.jobs.filter((job) => job.offered);
    const what = offered.length
      ? offered.map((job) => (english ? job.nameEn : job.nameRo)).join(' · ')
      : (request.descriptionLine ?? '').slice(0, SUBJECT_MAX);
    return what
      ? `${request.driver.shortName} · ${what}`
      : request.driver.shortName;
  });
  protected readonly leftOut = computed(() => {
    const english = this.i18n.language() === 'en';
    return (this.request()?.jobs ?? [])
      .filter((job) => !job.offered)
      .map((job) => (english ? job.nameEn : job.nameRo))
      .join(', ');
  });

  constructor() {
    void this.load();
  }

  protected async load() {
    this.failed.set(false);
    try {
      const request = await this.requests.garageRequestsControllerGet({
        id: this.task.data.requestId,
      });
      this.prefill(request);
      this.request.set(request);
    } catch {
      this.failed.set(true);
    }
  }

  protected noteLength() {
    this.changed();
    return this.form.controls.note.value.length;
  }

  protected wide() {
    this.changed();
    const { fromLei, toLei } = this.form.value;
    return fromLei != null && toLei != null && toLei > fromLei * WIDE_FACTOR;
  }

  protected minTime() {
    this.changed();
    return this.slot.controls.day.value === this.today ? nextQuarter() : null;
  }

  protected blocked() {
    this.changed();
    return !this.online() || this.form.invalid;
  }

  // The message a price, the duration, the slot or the note shows: a missing
  // value once the field is left, any other problem as soon as it is typed.
  protected message(control: AbstractControl): string {
    this.changed();
    const errors: ValidationErrors = { ...control.errors };
    if (
      (control === this.form.controls.fromLei ||
        control === this.form.controls.toLei) &&
      this.form.errors?.['low_above_high']
    )
      errors['low_above_high'] = true;
    const code = [...CODES, 'low_above_high'].find((c) => c in errors);
    if (!code) return '';
    if (code === 'required' && !control.touched) return '';
    if (!control.touched && !control.dirty) return '';
    if (code === 'server') return this.text(String(errors['server']));
    if (code === 'maxlength')
      return this.text(code, {
        requiredLength: errors['maxlength'].requiredLength,
      });
    return this.text(code);
  }

  // Enter in a field sends a valid form and nothing else.
  protected enter(event: Event) {
    event.preventDefault();
    if (!this.blocked()) this.save.submit();
  }

  protected submit() {
    if (!this.blocked()) this.save.submit();
  }

  private text(code: string, params?: Record<string, number>) {
    for (const key of [
      `${MESSAGES}.field.${code}`,
      `shell.form.field.${code}`,
    ]) {
      const found = this.i18n.t(key, params);
      if (found !== key) return found;
    }
    return this.i18n.t('shell.form.field.invalid');
  }

  // The included jobs' brand rows summed; a job with no row adds nothing, an
  // open top leaves the top empty, and the duration sums the rows that have one.
  private prefill(request: GarageRequestDto) {
    const rows = request.jobs.flatMap((job) =>
      job.offered && job.price ? [job.price] : [],
    );
    if (!rows.length) return;
    const total = (values: number[]) => values.reduce((a, b) => a + b, 0);
    const from = total(rows.map((r) => r.fromBani));
    const tops = rows.map((r) => r.toBani);
    const to = tops.includes(null) ? null : total(tops as number[]);
    const durations = rows.flatMap((r) =>
      r.durationMinutes === null ? [] : [r.durationMinutes],
    );
    const minutes = durations.length ? total(durations) : null;
    this.form.patchValue({
      durationMinutes:
        minutes === null
          ? {}
          : { hours: Math.floor(minutes / 60), minutes: String(minutes % 60) },
      fromLei: from === null ? null : baniToLei(from),
      toLei: to === null ? null : baniToLei(to),
    });
    if (this.duration.invalid && minutes !== null)
      this.duration.markAllAsTouched();
  }

  private body(): SendQuoteDto {
    const value = this.form.getRawValue();
    const note = value.note.trim();
    return {
      durationMinutes:
        Number(value.durationMinutes.hours) * 60 +
        Number(value.durationMinutes.minutes),
      fromLei: value.fromLei as number,
      note: note === '' ? null : note,
      requestId: this.task.data.requestId,
      slot: bucharestInstant(value.slot.day, value.slot.time),
      toLei: value.toLei as number,
    };
  }

  // Another answer or a closed request ends the dialog; its message is the toast.
  private refused(failure: unknown) {
    if (!(failure instanceof HttpErrorResponse) || failure.status !== 409)
      return;
    const { code, detail } = toProblem(failure);
    const key = `${MESSAGES}.problem.${code}`;
    const said = this.i18n.t(key);
    toast(said !== key ? said : (detail ?? said));
    this.task.close('refused');
  }
}
