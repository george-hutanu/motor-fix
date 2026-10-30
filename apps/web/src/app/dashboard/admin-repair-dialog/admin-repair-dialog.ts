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

const bani = (lei: number) => Math.round(lei * 100);
const lei = (value: number | null) => (value === null ? null : value / 100);

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
    costBani: new FormControl<number | null>(null, {
      validators: limit(
        'costBani',
        (v) =>
          v === null ||
          (typeof v === 'number' &&
            v >= 0 &&
            Number.isInteger(Math.round(v * 1000) / 10) &&
            bani(v) <= BANI_MAX),
      ),
    }),
    doneOn: new FormControl('', {
      nonNullable: true,
      validators: limit(
        'doneOn',
        (v) => typeof v === 'string' && DAY.test(v) && v <= this.today,
      ),
    }),
    odometerKm: new FormControl<number | null>(null, {
      validators: limit(
        'odometerKm',
        (v) =>
          (v === null && this.repair().odometerKm === null) ||
          (typeof v === 'number' &&
            Number.isInteger(v) &&
            v >= 0 &&
            v <= KM_MAX),
      ),
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
      this.task.data.saved(repair);
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
      costBani: lei(r.costBani),
      doneOn: r.doneOn,
      odometerKm: r.odometerKm,
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

  // The fields the admin changed, as the API takes them, and the version read.
  private changes(): CorrectClientRepairDto {
    const { costBani, doneOn, odometerKm, what } = this.form.controls;
    const body: CorrectClientRepairDto = { version: this.repair().version };
    if (what.dirty) body.what = what.value.trim();
    if (doneOn.dirty) body.doneOn = doneOn.value;
    if (odometerKm.dirty && odometerKm.value !== null)
      body.odometerKm = odometerKm.value;
    if (costBani.dirty)
      body.costBani = costBani.value === null ? null : bani(costBani.value);
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
