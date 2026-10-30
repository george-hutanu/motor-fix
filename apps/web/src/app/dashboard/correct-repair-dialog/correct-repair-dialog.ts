import { HttpErrorResponse } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  type AbstractControl,
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  type ValidatorFn,
} from '@angular/forms';
import { todayInBucharest } from '@motor-fix/contracts/garage-hours';
import { MAX_KM } from '@motor-fix/contracts/plate';
import {
  CarsService,
  type ClientRepairDto,
  type CorrectClientRepairDto,
} from '@motor-fix/data-access';
import { formatKm, I18n, TranslatePipe } from '@motor-fix/i18n';
import {
  injectOverlayTask,
  type OverlayResult,
  TaskError,
  TaskSubmit,
  taskSave,
} from '@motor-fix/overlays';
import { HlmButton, HlmInput, HlmLabel } from '@motor-fix/ui-cockpit';

// The API's own limits (the correction's contract): what was done is 1 to
// 200 characters once trimmed, an amount at most 920 000 lei.
const WHAT_MAX = 200;
const COST_MAX_BANI = 92_000_000;

// The dialog closes with the saved repair, or 'unshared' when its client
// stopped sharing it meanwhile.
export type CorrectRepairResult = ClientRepairDto | 'unshared';

export interface CorrectRepairData {
  item: ClientRepairDto;
  // The list read again: the repair as it is now, or nothing when it is gone.
  refresh: () => Promise<ClientRepairDto | undefined>;
}

type Changes = Omit<CorrectClientRepairDto, 'version'>;

// Whole km, digits only, within the odometer's range.
const kmOf = (value: string): number | null => {
  const typed = value.trim();
  if (!/^\d{1,7}$/.test(typed)) return null;
  const km = Number(typed);
  return km <= MAX_KM ? km : null;
};

// Lei with a comma or a dot, as bani; why it is refused, else the amount.
const baniOf = (
  value: string,
):
  | { bani: number }
  | { error: 'costFormat' | 'costDecimals' | 'costWithin' } => {
  const match = /^(\d{1,9})(?:[.,](\d+))?$/.exec(value.trim());
  if (!match) return { error: 'costFormat' };
  const [, whole, fraction = ''] = match;
  if (fraction.length > 2) return { error: 'costDecimals' };
  const bani = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  return bani <= COST_MAX_BANI ? { bani } : { error: 'costWithin' };
};

const leiText = (bani: number | null, language: string) => {
  if (bani === null) return '';
  const whole = Math.floor(bani / 100);
  const cents = bani % 100;
  if (!cents) return String(whole);
  return `${whole}${language === 'en' ? '.' : ','}${String(cents).padStart(2, '0')}`;
};

// Corrects one repair a client logged here and shares: the four fields as
// the row read them, only the changed ones sent with the version read. A
// repair saved meanwhile is read again into the dialog; one no longer
// shared closes it.
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    HlmButton,
    HlmInput,
    HlmLabel,
    ReactiveFormsModule,
    TaskError,
    TaskSubmit,
    TranslatePipe,
  ],
  selector: 'mf-correct-repair-dialog',
  styleUrl: './correct-repair-dialog.css',
  templateUrl: './correct-repair-dialog.html',
})
export class CorrectRepairDialog {
  private readonly api = inject(CarsService);
  private readonly i18n = inject(I18n);
  protected readonly task = injectOverlayTask<
    CorrectRepairData,
    OverlayResult<CorrectRepairResult>
  >();
  // The repair as last read: what a change is measured against.
  private loaded = this.task.data.item;
  protected readonly today = todayInBucharest();
  protected readonly subject = this.i18n.t(
    'garage.clientRepairs.correct.subject',
    {
      car: `${this.loaded.car.brandName} ${this.loaded.car.model} ${this.loaded.car.year}`,
      name: this.loaded.driver.shortName,
    },
  );

  protected readonly form = new FormGroup({
    costBani: new FormControl('', {
      nonNullable: true,
      validators: (control) => {
        const typed = String(control.value ?? '');
        if (!typed.trim()) return null;
        const amount = baniOf(typed);
        return 'error' in amount ? { [amount.error]: true } : null;
      },
    }),
    doneOn: new FormControl('', {
      nonNullable: true,
      validators: (control) => {
        const day = String(control.value ?? '');
        if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return { dayRequired: true };
        return day > todayInBucharest() ? { futureDay: true } : null;
      },
    }),
    odometerKm: new FormControl('', {
      nonNullable: true,
      // A repair logged without a reading may stay without one.
      validators: (control) => {
        const typed = String(control.value ?? '');
        if (!typed.trim() && this.loaded.odometerKm === null) return null;
        return kmOf(typed) === null ? { odometerWithin: true } : null;
      },
    }),
    what: new FormControl('', {
      nonNullable: true,
      validators: ((control) => {
        const length = String(control.value ?? '').trim().length;
        return length >= 1 && length <= WHAT_MAX ? null : { whatWithin: true };
      }) satisfies ValidatorFn,
    }),
  });

  protected readonly save = taskSave({
    done: (repair: ClientRepairDto) => this.task.close(repair),
    form: this.form,
    messages: 'garage.clientRepairs.correct',
    send: () => this.send(),
  });

  // The lower reading the owner was asked to check, and the value asked
  // about: pressing Salvează again with that value sends it.
  protected readonly lower = signal<number | null>(null);
  private asked: number | null = null;
  protected readonly lowerText = computed(() => {
    const km = this.lower();
    return km === null
      ? ''
      : this.i18n.t('garage.clientRepairs.correct.lower', {
          km: formatKm(km, this.i18n.language()),
        });
  });
  protected readonly stale = computed(
    () => this.save.problem()?.code === 'stale_version',
  );
  // Moves on every change, touch and status of the form, for the messages.
  private readonly changes = signal(0);

  constructor() {
    void this.i18n.enter('garage');
    this.seed(this.loaded);
    this.form.events
      .pipe(takeUntilDestroyed())
      .subscribe(() => this.changes.update((n) => n + 1));
    // A changed reading is a new one: asked about again if still lower.
    this.form.controls.odometerKm.valueChanges
      .pipe(takeUntilDestroyed())
      .subscribe(() => {
        if (kmOf(this.form.controls.odometerKm.value) !== this.asked)
          this.lower.set(null);
      });
  }

  // A field's message: the server's once it answered, else the rule's as
  // soon as the owner leaves the field (or the press reveals it).
  protected errorOf(control: AbstractControl): string | null {
    this.changes();
    const errors = control.errors;
    if (!errors) return null;
    if ('server' in errors) return this.save.fieldError(control);
    if (!control.touched) return null;
    return this.i18n.t(
      `garage.clientRepairs.correct.field.${Object.keys(errors)[0]}`,
    );
  }

  protected submit() {
    if (this.save.state() === 'sending') return;
    if (this.form.invalid) {
      this.save.submit();
      return;
    }
    const changes = this.changed();
    if (!Object.keys(changes).length) {
      this.task.close('cancelled');
      return;
    }
    const km = changes.odometerKm;
    const before = this.loaded.odometerKm;
    if (
      km !== undefined &&
      before !== null &&
      km < before &&
      km !== this.asked
    ) {
      this.asked = km;
      this.lower.set(before);
      return;
    }
    this.save.submit();
  }

  // Only the fields that differ from the repair as read, as the API takes them.
  private changed(): Changes {
    const { costBani, doneOn, odometerKm, what } = this.form.getRawValue();
    const changes: Changes = {};
    const trimmed = what.trim();
    if (trimmed !== this.loaded.what) changes.what = trimmed;
    if (doneOn !== this.loaded.doneOn) changes.doneOn = doneOn;
    const km = kmOf(odometerKm);
    if (km !== null && km !== this.loaded.odometerKm) changes.odometerKm = km;
    const amount = costBani.trim() ? baniOf(costBani) : { bani: null };
    const bani = 'bani' in amount ? amount.bani : this.loaded.costBani;
    if (bani !== this.loaded.costBani) changes.costBani = bani;
    return changes;
  }

  private async send(): Promise<ClientRepairDto> {
    try {
      return await this.api.clientRepairsControllerCorrect({
        body: { ...this.changed(), version: this.loaded.version },
        id: this.loaded.id,
      });
    } catch (failure) {
      if (failure instanceof HttpErrorResponse) {
        if (failure.status === 404) this.task.close('unshared');
        if (failure.status === 409) await this.reload();
      }
      throw failure;
    }
  }

  // Saved meanwhile: the repair as it is now replaces what was typed.
  private async reload() {
    let fresh: ClientRepairDto | undefined;
    try {
      fresh = await this.task.data.refresh();
    } catch {
      // The line stays; the next Salvează meets the 409 again and re-reads.
      return;
    }
    if (!fresh) {
      this.task.close('unshared');
      return;
    }
    this.loaded = fresh;
    this.seed(fresh);
  }

  // The form as the repair reads, every field untouched, nothing asked.
  private seed(repair: ClientRepairDto) {
    this.asked = null;
    this.lower.set(null);
    this.form.reset({
      costBani: leiText(repair.costBani, this.i18n.language()),
      doneOn: repair.doneOn,
      odometerKm: repair.odometerKm === null ? '' : String(repair.odometerKm),
      what: repair.what,
    });
  }
}
