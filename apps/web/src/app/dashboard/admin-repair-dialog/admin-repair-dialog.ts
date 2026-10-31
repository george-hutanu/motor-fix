import { HttpErrorResponse } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import {
  type AbstractControl,
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  type ValidatorFn,
} from '@angular/forms';
import {
  type AdminRepairDto,
  AdminService,
  type CorrectClientRepairDto,
} from '@motor-fix/data-access';
import {
  formatDay,
  formatKm,
  formatLei,
  I18n,
  TranslatePipe,
} from '@motor-fix/i18n';
import {
  FieldError,
  injectOverlayTask,
  type OverlayResult,
  TaskError,
  TaskSubmit,
  taskSave,
} from '@motor-fix/overlays';
import { HlmButton, HlmInput } from '@motor-fix/ui-cockpit';

import { bucharestToday } from '../admin-restore-garage/admin-restore-garage';

export interface AdminRepairData {
  repair: AdminRepairDto;
  // Told after each saved correction, with the repair as now stored.
  saved: (repair: AdminRepairDto) => void;
}

// The dialog closes itself only when the repair is gone.
export type AdminRepairResult = 'gone';

// The limits the API keeps on a correction (CorrectClientRepairDto).
const WHAT_MAX = 200;
const KM_MAX = 2_000_000;
const BANI_MAX = 92_000_000;

const DAY = /^\d{4}-\d{2}-\d{2}$/;

// A broken limit is reported under the field's own name: taskSave reads its
// text at `<messages>.field.<name>`, where a 400 for that field lands too.
const limit =
  (name: string, holds: (value: unknown) => boolean): ValidatorFn =>
  (control: AbstractControl) =>
    holds(control.value) ? null : { server: name };

// The amount and the odometer are typed as text, so a Romanian decimal comma
// is read and a mistyped value is refused rather than read as an empty field.
// Empty is null; a value that is not a number is undefined.
const LEI = /^\d+([.,]\d{1,2})?$/;
const WHOLE = /^\d+$/;
const readBani = (text: string): number | null | undefined => {
  const typed = text.trim();
  if (typed === '') return null;
  if (!LEI.test(typed)) return undefined;
  const [whole, cents = ''] = typed.split(/[.,]/);
  return Number(whole) * 100 + Number(cents.padEnd(2, '0'));
};
const readKm = (text: string): number | null | undefined => {
  const typed = text.trim();
  if (typed === '') return null;
  return WHOLE.test(typed) ? Number(typed) : undefined;
};
const leiText = (bani: number | null) =>
  bani === null ? '' : String(bani / 100);

// A driver's logged repair as the admin reads it, and the form that corrects
// it as MotorFix: only the changed fields are sent, with the version read.
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
  selector: 'mf-admin-repair-dialog',
  styleUrl: './admin-repair-dialog.css',
  templateUrl: './admin-repair-dialog.html',
})
export class AdminRepairDialog {
  private readonly api = inject(AdminService);
  private readonly i18n = inject(I18n);
  protected readonly task = injectOverlayTask<
    AdminRepairData,
    OverlayResult<AdminRepairResult>
  >();

  protected readonly repair = signal(this.task.data.repair);
  protected readonly mode = signal<'view' | 'edit'>('view');
  // What the dialog last said: the save, or the repair changed meanwhile.
  protected readonly said = signal('');
  protected readonly today = bucharestToday();

  protected readonly car = computed(() => {
    const { brandName, model, year } = this.repair().car;
    return `${brandName} ${model} ${year}`;
  });

  protected readonly lines = computed(() => {
    const r = this.repair();
    const language = this.i18n.language();
    const t = (key: string) => this.i18n.t(`admin.users.dialogs.repair.${key}`);
    return [
      { label: t('car'), value: this.car() },
      { label: t('garage'), value: r.garageName },
      { label: t('what'), value: r.what },
      { label: t('date'), value: formatDay(r.doneOn, language) },
      ...(r.odometerKm === null
        ? []
        : [{ label: t('odometer'), value: formatKm(r.odometerKm, language) }]),
      ...(r.costBani === null
        ? []
        : [{ label: t('amount'), value: formatLei(r.costBani, language) }]),
    ];
  });

  protected readonly corrected = computed(() => {
    const r = this.repair();
    if (r.correctedBy === null) return '';
    return this.i18n.t(
      `admin.users.dialogs.repair.correctedBy.${r.correctedBy}`,
      {
        garage: r.garageName,
      },
    );
  });

  // Each control is named after the field the API takes, so a 400 for a
  // field shows at its control; the amount is typed in lei, sent in bani.
  protected readonly form = new FormGroup({
    costBani: new FormControl('', {
      nonNullable: true,
      validators: limit('costBani', (v) => {
        const bani = readBani(String(v ?? ''));
        return bani === null || (bani !== undefined && bani <= BANI_MAX);
      }),
    }),
    doneOn: new FormControl('', {
      nonNullable: true,
      validators: limit(
        'doneOn',
        (v) => typeof v === 'string' && DAY.test(v) && v <= this.today,
      ),
    }),
    odometerKm: new FormControl('', {
      nonNullable: true,
      validators: limit('odometerKm', (v) => {
        const km = readKm(String(v ?? ''));
        if (km === null) return this.repair().odometerKm === null;
        return km !== undefined && km <= KM_MAX;
      }),
    }),
    what: new FormControl('', {
      nonNullable: true,
      validators: limit('what', (v) => {
        const length = String(v ?? '').trim().length;
        return length >= 1 && length <= WHAT_MAX;
      }),
    }),
  });

  protected readonly save = taskSave({
    done: (repair: AdminRepairDto) => {
      this.repair.set(repair);
      this.said.set(this.i18n.t('admin.users.dialogs.repair.saved'));
      this.show('view');
    },
    form: this.form,
    messages: 'admin.users.dialogs.repair',
    send: () =>
      this.api
        .adminRepairsControllerCorrect({
          body: this.changes(),
          id: this.repair().id,
        })
        // The section hears of a correction even when the dialog was closed
        // while it was on its way, which the overlays allow.
        .then((repair) => {
          this.task.data.saved(repair);
          return repair;
        })
        .catch((failure: unknown) => this.refused(failure)),
  });

  // A failed save's line, unless it is the repair changed meanwhile, which
  // the dialog says itself.
  protected readonly failedOtherwise = computed(
    () => this.save.problem()?.status !== 409,
  );

  constructor() {
    void this.i18n.enter('admin');
  }

  protected correct() {
    const r = this.repair();
    this.form.reset({
      costBani: leiText(r.costBani),
      doneOn: r.doneOn,
      odometerKm: r.odometerKm === null ? '' : String(r.odometerKm),
      what: r.what,
    });
    this.said.set('');
    this.show('edit');
  }

  protected cancel() {
    this.said.set('');
    this.show('view');
  }

  private show(mode: 'view' | 'edit') {
    this.mode.set(mode);
    this.task.focusStart();
  }

  // The fields whose value differs from the one loaded, as the API takes
  // them, and the version read: a field typed back to its value is not sent.
  private changes(): CorrectClientRepairDto {
    const r = this.repair();
    const value = this.form.getRawValue();
    const body: CorrectClientRepairDto = { version: r.version };
    const what = value.what.trim();
    if (what !== r.what) body.what = what;
    if (value.doneOn !== r.doneOn) body.doneOn = value.doneOn;
    const km = readKm(value.odometerKm);
    if (km != null && km !== r.odometerKm) body.odometerKm = km;
    const bani = readBani(value.costBani);
    if (bani !== undefined && bani !== r.costBani) body.costBani = bani;
    return body;
  }

  // 404: the repair is gone, the dialog closes. 409: it changed meanwhile;
  // the form is filled again with what is stored now, the edits discarded.
  private async refused(failure: unknown): Promise<never> {
    const status = failure instanceof HttpErrorResponse ? failure.status : 0;
    if (status === 404) this.task.close('gone');
    if (status === 409) await this.reread();
    throw failure;
  }

  private async reread() {
    const key = 'admin.users.dialogs.repair';
    try {
      this.repair.set(
        await this.api.adminRepairsControllerOpen({ id: this.repair().id }),
      );
      this.correct();
      this.said.set(this.i18n.t(`${key}.changed`));
    } catch (failure) {
      if (failure instanceof HttpErrorResponse && failure.status === 404)
        this.task.close('gone');
      else this.said.set(this.i18n.t(`${key}.rereadFailed`));
    }
  }
}
