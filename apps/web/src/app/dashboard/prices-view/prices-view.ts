import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { JOBS_MAX } from '@motor-fix/contracts/price-range';
import {
  type BrandRangeItemDto,
  GaragesService,
  type PriceListItemDto,
  type PublicLabourDto,
} from '@motor-fix/data-access';
import {
  formatDuration,
  formatWholeLeiRange,
  I18n,
  TranslatePipe,
} from '@motor-fix/i18n';
import { Overlays } from '@motor-fix/overlays';
import { HlmButton } from '@motor-fix/ui-cockpit';
import { filter, merge } from 'rxjs';

import {
  JobPicker,
  type JobPickerData,
  type JobPickerResult,
} from './job-picker/job-picker';
import {
  type EditableRow,
  PriceRangeEditor,
  type PriceRangeEditorData,
  type PriceRangeEditorResult,
  priceText,
} from './price-range-editor/price-range-editor';
import {
  RemoveJob,
  type RemoveJobData,
  type RemoveJobResult,
} from './remove-job/remove-job';
import { liveView } from '../../live/view';
import { Live } from '../live';
import { garageOf, Session } from '../session';

type Range = { fromBani?: number; toBani?: number };
type Reason = NonNullable<PriceListItemDto['reason']>;

// Each reason the client knows, typed from it so a new code fails the build
// here; a code that arrives without a label (or none at all) reads "hidden".
const REASONS: Record<Reason, true> = {
  awaiting_approval: true,
  hidden_by_garage: true,
  no_top_price: true,
  not_authorised: true,
  rejected: true,
};

// "Prețuri": every job of the garage's price list in the list's order, with
// whether drivers see it and why not, its range and its brand ranges, then the
// hourly labour range. The owner turns editing on to change a range, hide,
// show or remove a job in place, and to add one from the catalogue; each write
// re-reads the list rather than patching a row.
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [HlmButton, TranslatePipe],
  selector: 'mf-prices-view',
  styleUrl: './prices-view.css',
  templateUrl: './prices-view.html',
})
export class PricesView {
  private readonly api = inject(GaragesService);
  private readonly session = inject(Session);
  private readonly live = inject(Live);
  private readonly i18n = inject(I18n);
  private readonly overlays = inject(Overlays);
  protected readonly skeletons = [1, 2, 3];
  private readonly garageId = computed(
    () => garageOf(this.session.shown())?.garageId ?? '',
  );
  // Only the owner changes prices; the server checks it again.
  protected readonly owner = computed(
    () => garageOf(this.session.shown())?.role === 'owner',
  );
  protected readonly editing = signal(false);
  // The jobs whose hide or show is on its way, and the one whose last failed.
  protected readonly busy = signal<ReadonlySet<string>>(new Set());
  protected readonly failed = signal<string | null>(null);
  // Its own garage's list changes, and a catalogue decision about a job (whose
  // subject is the job, not the garage) may change a job's state.
  protected readonly view = liveView(
    () => this.api.priceListControllerRead({ garageId: this.garageId() }),
    {
      changes: merge(
        this.live
          .on(['price_list.updated'])
          .pipe(filter((m) => m.id === this.garageId())),
        this.live.on(['catalogue_job.decided']),
      ),
      goneOn: [404],
      resync: this.live.resync,
      retryAfter: 60_000,
    },
  );

  // Each hide or show pressed, drawn over its row until the list is read
  // again: a re-read is newer than the press, whatever the save answers. A
  // saved one stays drawn when the re-read after it fails.
  private readonly pending = signal<
    ReadonlyMap<string, { reads: number; visible: boolean }>
  >(new Map());
  protected readonly items = computed(() => {
    const reads = this.view.reads();
    const pending = this.pending();
    return (this.view.value()?.items ?? []).map((row) => {
      const press = pending.get(row.priceId);
      if (press?.reads !== reads) return row;
      return {
        ...row,
        public: press.visible,
        reason: press.visible ? undefined : ('hidden_by_garage' as const),
        visible: press.visible,
      };
    });
  });

  constructor() {
    void this.i18n.enter('garage');
  }

  protected name({ nameEn, nameRo }: { nameEn: string; nameRo: string }) {
    return this.i18n.language() === 'en' && nameEn.trim() ? nameEn : nameRo;
  }

  protected duration(row: PriceListItemDto) {
    return formatDuration(row.durationMinutes, this.i18n.language());
  }

  protected state({
    public: shown,
    reason,
    rejectionReason,
  }: PriceListItemDto) {
    if (shown) return 'garage.prices.state.public';
    if (reason === 'rejected' && rejectionReason)
      return 'garage.prices.state.rejectedWith';
    return reason && Object.hasOwn(REASONS, reason)
      ? `garage.prices.state.${reason}`
      : 'garage.prices.state.hidden';
  }

  // Both ends as a range; the low end alone as a starting price.
  protected price(range: Range) {
    return priceText(range, this.i18n);
  }

  // Only a job with its own row has a range to change: one priced by brand
  // alone comes without an id.
  protected editable(row: PriceListItemDto): row is EditableRow {
    return Boolean(row.priceId && row.updatedAt);
  }

  // The cap counts the jobs with their own row, as the server does.
  protected full(items: readonly PriceListItemDto[]) {
    return items.filter((row) => row.priceId).length >= JOBS_MAX;
  }

  protected add(items: readonly PriceListItemDto[]) {
    void this.once(async () => {
      const picked = await this.overlays.open<JobPickerResult, JobPickerData>(
        JobPicker,
        {
          data: { listed: items.map((row) => row.jobTypeId) },
          shape: 'dialog',
          title: 'garage.prices.picker.title',
        },
      );
      if (picked === 'propose') return this.propose();
      if (typeof picked !== 'object') return;
      await this.overlays.open<PriceRangeEditorResult, PriceRangeEditorData>(
        PriceRangeEditor,
        {
          data: {
            garageId: this.garageId(),
            job: picked.job,
            kind: 'new',
            listed: () => this.view.reload(),
          },
          shape: 'dialog',
          title: this.name(picked.job),
        },
      );
      // Also after a refusal: the job may be on the list by now.
      this.view.reload();
    });
  }

  // A job the catalogue lacks, proposed with its range: it joins the list
  // hidden until an admin approves it.
  private async propose() {
    const result = await this.overlays.open<
      PriceRangeEditorResult,
      PriceRangeEditorData
    >(PriceRangeEditor, {
      data: { garageId: this.garageId(), kind: 'propose' },
      shape: 'dialog',
      title: 'garage.prices.propose.title',
    });
    if (result === 'saved') this.view.reload();
  }

  // The note under a proposed job while it waits for an admin.
  protected waiting({ reason }: PriceListItemDto) {
    return reason === 'awaiting_approval';
  }

  protected async toggle(row: EditableRow) {
    const { priceId } = row;
    if (this.busy().has(priceId)) return;
    const visible = row.visible === false;
    this.busy.update((busy) => new Set(busy).add(priceId));
    this.failed.set(null);
    this.pending.update((pending) =>
      new Map(pending).set(priceId, { reads: this.view.reads(), visible }),
    );
    try {
      await this.api.priceListControllerSetRange({
        body: { visible },
        garageId: this.garageId(),
        priceId,
      });
      await this.view.reload();
    } catch {
      this.pending.update((pending) => {
        const left = new Map(pending);
        left.delete(priceId);
        return left;
      });
      this.failed.set(priceId);
    } finally {
      this.busy.update((busy) => {
        const left = new Set(busy);
        left.delete(priceId);
        return left;
      });
    }
  }

  protected remove(row: EditableRow) {
    void this.once(async () => {
      const result = await this.overlays.open<RemoveJobResult, RemoveJobData>(
        RemoveJob,
        {
          data: { garageId: this.garageId(), priceId: row.priceId },
          shape: 'dialog',
          title: 'garage.prices.removeDialog.title',
        },
      );
      if (result === 'removed') this.view.reload();
    });
  }

  protected editRow(row: EditableRow) {
    void this.edit(
      {
        garageId: this.garageId(),
        item: row,
        kind: 'row',
        // The row as the live list re-reads it, so the editor can say when
        // another session changed its range meanwhile.
        shown: computed(() =>
          this.view
            .value()
            ?.items.find(
              (item): item is EditableRow =>
                this.editable(item) && item.priceId === row.priceId,
            ),
        ),
      },
      this.name(row),
    );
  }

  protected editBrand(row: PriceListItemDto, brand: BrandRangeItemDto) {
    void this.edit(
      {
        brand,
        garageId: this.garageId(),
        jobTypeId: row.jobTypeId,
        kind: 'brand',
      },
      `${this.name(row)} · ${brand.name}`,
    );
  }

  protected editLabour(labour: PublicLabourDto | undefined) {
    void this.edit(
      {
        garageId: this.garageId(),
        kind: 'labour',
        ...(labour && { labour }),
      },
      'garage.prices.labourTitle',
    );
  }

  private edit(data: PriceRangeEditorData, title: string) {
    return this.once(async () => {
      const result = await this.overlays.open<
        PriceRangeEditorResult,
        PriceRangeEditorData
      >(PriceRangeEditor, { data, shape: 'dialog', title });
      if (result === 'saved') this.view.reload();
    });
  }

  // One overlay at a time: a second press while one is open is ignored.
  private opened = false;

  private async once(run: () => Promise<void>) {
    if (this.opened) return;
    this.opened = true;
    try {
      await run();
    } finally {
      this.opened = false;
    }
  }

  protected labour({ fromBani, toBani }: PublicLabourDto) {
    return this.i18n.t('garage.prices.labour', {
      range: formatWholeLeiRange(fromBani, toBani, this.i18n.language()),
    });
  }
}
