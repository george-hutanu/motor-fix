import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
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
  type EditableRow,
  PriceRangeEditor,
  type PriceRangeEditorData,
  type PriceRangeEditorResult,
} from './price-range-editor/price-range-editor';
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
// hourly labour range. The owner turns editing on to change a range in place;
// a save re-reads the list rather than patching a row.
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
  // Its own garage's list changes, and a catalogue decision about a job (whose
  // subject is the job, not the garage) may change a job's state.
  // TODO: nothing emits catalogue_job.decided until the admin's catalogue
  // decision story lands; the hub already routes it to the owner.
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

  constructor() {
    void this.i18n.enter('garage');
  }

  protected name(row: PriceListItemDto) {
    return this.i18n.language() === 'en' && row.nameEn.trim()
      ? row.nameEn
      : row.nameRo;
  }

  protected duration(row: PriceListItemDto) {
    return formatDuration(row.durationMinutes, this.i18n.language());
  }

  protected state({ public: shown, reason }: PriceListItemDto) {
    if (shown) return 'garage.prices.state.public';
    return reason && Object.hasOwn(REASONS, reason)
      ? `garage.prices.state.${reason}`
      : 'garage.prices.state.hidden';
  }

  // Both ends as a range; the low end alone as a starting price.
  protected price({ fromBani, toBani }: Range) {
    const language = this.i18n.language();
    if (fromBani !== undefined && toBani === undefined) {
      return this.i18n.t('garage.prices.from', {
        amount: formatWholeLeiRange(fromBani, fromBani, language),
      });
    }
    return formatWholeLeiRange(fromBani, toBani, language);
  }

  // Only a job with its own row has a range to change: one priced by brand
  // alone comes without an id.
  protected editable(row: PriceListItemDto): row is EditableRow {
    return Boolean(row.priceId && row.updatedAt);
  }

  protected editRow(row: EditableRow) {
    void this.edit(
      { garageId: this.garageId(), item: row, kind: 'row' },
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

  // One editor at a time: a second press while one opens is ignored.
  private opened = false;

  private async edit(data: PriceRangeEditorData, title: string) {
    if (this.opened) return;
    this.opened = true;
    try {
      const result = await this.overlays.open<
        PriceRangeEditorResult,
        PriceRangeEditorData
      >(PriceRangeEditor, { data, shape: 'dialog', title });
      if (result === 'saved') this.view.reload();
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
