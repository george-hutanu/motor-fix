import { HttpErrorResponse } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import {
  checkPriceRange,
  JOB_NAME_MAX,
  PROPOSED_JOB_NAME_MIN,
} from '@motor-fix/contracts/price-range';
import {
  type BrandRangeItemDto,
  GaragesService,
  type JobTypeDto,
  type PriceListItemDto,
  type PublicLabourDto,
} from '@motor-fix/data-access';
import { formatDuration, I18n, TranslatePipe } from '@motor-fix/i18n';
import {
  injectOverlayTask,
  type OverlayResult,
  TaskError,
  TaskSubmit,
  taskSave,
  toProblem,
} from '@motor-fix/overlays';
import { HlmButton, HlmInput } from '@motor-fix/ui-cockpit';

import { LeiInput } from '../../../public/lei-input';

// A job's own row, as the read gives it once the garage has one.
export type EditableRow = PriceListItemDto & {
  priceId: string;
  updatedAt: string;
};

export type PriceRangeEditorData =
  | { kind: 'row'; garageId: string; item: EditableRow }
  | { kind: 'new'; garageId: string; job: JobTypeDto }
  | { kind: 'propose'; garageId: string }
  | {
      kind: 'brand';
      garageId: string;
      jobTypeId: string;
      brand: BrandRangeItemDto;
    }
  | { kind: 'labour'; garageId: string; labour?: PublicLabourDto };

// Saved: the opener re-reads its list; the editor patches nothing itself.
export type PriceRangeEditorResult = 'saved';

type RangeField = 'fromBani' | 'toBani' | 'durationMinutes';
type Field = RangeField | 'name';

const MESSAGES = 'garage.prices.editor';
const NAME_TEXTS = 'garage.prices.propose.field';
const PRICE_TEXTS = 'public.listing.prices.errors';
// The range rule's field names, and the form's field each one checks.
const RANGE_FIELD = {
  duration: 'durationMinutes',
  from: 'fromBani',
  to: 'toBani',
} as const;

// A refusal of the job itself (already listed, the list full) is the
// editor's own message, since no field shows the job; a full list refused
// on a proposal's name is the same message.
function jobRefused(failure: unknown): never {
  const problem = toProblem(failure);
  const job = problem.errors?.find(
    ({ code, field }) =>
      field === 'jobTypeId' || (field === 'name' && code === 'too_many'),
  );
  if (!job) throw failure;
  throw new HttpErrorResponse({
    error: { code: job.code },
    status: problem.status,
  });
}

// One job's range (and duration), a brand's range or the labour rate, changed
// in place, or a job added or proposed with its range: the same range rule
// the server runs, checked as it is typed.
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    HlmButton,
    HlmInput,
    LeiInput,
    ReactiveFormsModule,
    TaskError,
    TaskSubmit,
    TranslatePipe,
  ],
  selector: 'mf-price-range-editor',
  styleUrl: './price-range-editor.css',
  templateUrl: './price-range-editor.html',
})
export class PriceRangeEditor {
  private readonly api = inject(GaragesService);
  private readonly i18n = inject(I18n);
  protected readonly task = injectOverlayTask<
    PriceRangeEditorData,
    OverlayResult<PriceRangeEditorResult>
  >();
  protected readonly data = this.task.data;
  protected readonly timed =
    this.data.kind !== 'brand' && this.data.kind !== 'labour';
  protected readonly proposing = this.data.kind === 'propose';
  protected readonly f = { ...RANGE_FIELD, name: 'name' } as const;
  protected readonly sendLabel = this.proposing
    ? 'garage.prices.propose.send'
    : 'garage.prices.editor.save';
  // The stamp the row was read with; a 409 brings the newer one.
  private readonly stamp = signal(
    this.data.kind === 'row' ? this.data.item.updatedAt : '',
  );

  protected readonly form = new FormGroup({
    durationMinutes: new FormControl<number | null>(null),
    fromBani: new FormControl<number | null>(null),
    name: new FormControl('', { nonNullable: true }),
    toBani: new FormControl<number | null>(null),
  });
  private readonly changed = toSignal(this.form.events);

  protected readonly save = taskSave({
    done: () => this.task.close('saved'),
    form: this.form,
    messages: MESSAGES,
    send: () =>
      this.send().catch(async (failure: unknown) => {
        if (failure instanceof HttpErrorResponse && failure.status === 409)
          await this.reread();
        throw failure;
      }),
  });
  protected readonly sending = computed(() => this.save.state() === 'sending');

  // Each field's own problem, by the shared range rule; a brand or the labour
  // rate needs both ends, a job's top and duration may be cleared.
  private readonly problems = computed(() => {
    this.changed();
    const { durationMinutes, fromBani, toBani } = this.form.getRawValue();
    const found = new Map<Field, string>();
    const checked = checkPriceRange({
      durationMinutes: this.timed ? durationMinutes : null,
      fromBani: fromBani ?? 0,
      toBani,
    });
    for (const { code, field } of checked.errors) {
      const at = (RANGE_FIELD as Record<string, Field | undefined>)[field];
      if (!at || (at === 'fromBani' && fromBani === null)) continue;
      found.set(at, code);
    }
    this.missingEnds(found, fromBani, toBani);
    if (this.proposing) this.nameProblem(found);
    const wide = checked.warnings.length > 0;
    return { found, wide };
  });

  // An empty bottom is always a problem; an empty top only where both ends
  // are needed.
  private missingEnds(
    found: Map<Field, string>,
    fromBani: number | null,
    toBani: number | null,
  ) {
    if (fromBani === null)
      found.set('fromBani', this.timed ? 'required' : 'both_ends');
    if (toBani === null && !this.timed) found.set('toBani', 'both_ends');
  }

  // A proposal's name, within the server's bounds once trimmed.
  private nameProblem(found: Map<Field, string>) {
    const { length } = this.form.controls.name.value.trim();
    if (!length) found.set('name', 'required');
    else if (length < PROPOSED_JOB_NAME_MIN) found.set('name', 'short');
    else if (length > JOB_NAME_MAX) found.set('name', 'long');
  }

  constructor() {
    void this.i18n.enter('garage');
    void this.i18n.enter('public');
    this.fill(this.start());
  }

  protected bani(field: 'fromBani' | 'toBani') {
    this.changed();
    return this.form.controls[field].value ?? undefined;
  }

  protected typed(field: 'fromBani' | 'toBani', bani: number | undefined) {
    const control = this.form.controls[field];
    control.setValue(bani ?? null);
    control.markAsDirty();
  }

  protected left(field: Field) {
    this.form.controls[field].markAsTouched();
  }

  // The field's problem, a server's first; a missing value once the field
  // is left, any other as soon as it is typed or the range turns wrong.
  protected problem(field: Field): string {
    this.changed();
    const control = this.form.controls[field];
    const server = control.errors?.['server'];
    if (server) return this.text(field, String(server));
    const code = this.problems().found.get(field);
    if (!code) return '';
    const required = code === 'required' || code === 'both_ends';
    if (required && !control.touched && !control.dirty) return '';
    return this.text(field, code);
  }

  // What the field's message line says: its problem, else the wide-range
  // warning under the top, else the duration read back in hours.
  protected said(field: Field): string {
    const problem = this.problem(field);
    if (problem) return problem;
    if (field === 'toBani' && this.problems().wide)
      return this.i18n.t('public.listing.prices.wideRange');
    if (field === 'durationMinutes')
      return formatDuration(
        this.form.controls.durationMinutes.value,
        this.i18n.language(),
      );
    return '';
  }

  protected blocked() {
    this.changed();
    return this.sending() || this.problems().found.size > 0;
  }

  protected submit() {
    if (!this.blocked()) this.save.submit();
  }

  private text(field: Field, code: string) {
    const keys =
      code === 'both_ends'
        ? [`${MESSAGES}.bothEnds`]
        : field === 'name'
          ? [`${NAME_TEXTS}.${code}`]
          : field === 'durationMinutes'
            ? [`${MESSAGES}.duration.${code}`]
            : [`${PRICE_TEXTS}.${code}`];
    for (const key of [...keys, `shell.form.field.${code}`]) {
      const found = this.i18n.t(key);
      if (found !== key) return found;
    }
    return this.i18n.t('shell.form.field.invalid');
  }

  private start(): Partial<Record<RangeField, number>> {
    const { data } = this;
    if (data.kind === 'row') return data.item;
    if (data.kind === 'brand') return data.brand;
    if (data.kind === 'labour') return data.labour ?? {};
    return {};
  }

  private fill(range: Partial<Record<RangeField, number>>) {
    this.form.patchValue({
      durationMinutes: range.durationMinutes ?? null,
      fromBani: range.fromBani ?? null,
      toBani: range.toBani ?? null,
    });
  }

  private send(): Promise<unknown> {
    const { data } = this;
    const { durationMinutes, fromBani, name, toBani } = this.form.getRawValue();
    const range = { fromBani: fromBani as number, toBani: toBani as number };
    if (data.kind === 'brand')
      return this.api.priceListControllerSetBrandRange({
        body: range,
        brandId: data.brand.brandId,
        garageId: data.garageId,
        jobTypeId: data.jobTypeId,
      });
    if (data.kind === 'labour')
      return this.api.garageLabourControllerSet({
        body: range,
        garageId: data.garageId,
      });
    if (data.kind === 'propose')
      return this.api
        .catalogueJobsControllerPropose({
          body: {
            durationMinutes,
            fromBani: range.fromBani,
            name: name.trim(),
            toBani,
          },
          garageId: data.garageId,
        })
        .catch(jobRefused);
    if (data.kind === 'new')
      return this.api
        .priceListControllerAdd({
          body: {
            durationMinutes,
            fromBani: range.fromBani,
            jobTypeId: data.job.id,
            toBani,
          },
          garageId: data.garageId,
        })
        .catch(jobRefused);
    return this.api.priceListControllerSetRange({
      body: {
        durationMinutes,
        expectedUpdatedAt: this.stamp(),
        fromBani: range.fromBani,
        toBani,
      },
      garageId: data.garageId,
      priceId: data.item.priceId,
    });
  }

  // Another session saved the row first: its stored values come back into
  // the form, with the stamp they were saved at.
  private async reread() {
    const { data } = this;
    if (data.kind !== 'row') return;
    const list = await this.api.priceListControllerRead({
      garageId: data.garageId,
    });
    const row = list.items.find((item) => item.priceId === data.item.priceId);
    if (!row?.updatedAt) return;
    this.stamp.set(row.updatedAt);
    this.fill(row);
  }
}
