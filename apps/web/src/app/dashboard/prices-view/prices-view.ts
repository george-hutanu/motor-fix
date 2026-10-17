import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
} from '@angular/core';
import {
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
import { HlmButton } from '@motor-fix/ui-cockpit';
import { filter, merge } from 'rxjs';

import { liveView } from '../../live/view';
import { Live } from '../live';
import { garageOf, Session } from '../session';

type Range = { fromBani?: number; toBani?: number };

// "Prețuri": every job of the garage's price list in the list's order, with
// whether drivers see it and why not, its range and its brand ranges, then the
// hourly labour range. It reads only; the rows open nothing.
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
  protected readonly skeletons = [1, 2, 3];
  private readonly garageId = computed(
    () => garageOf(this.session.shown())?.garageId ?? '',
  );
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

  protected state(row: PriceListItemDto) {
    return `garage.prices.state.${row.public ? 'public' : row.reason}`;
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

  protected labour({ fromBani, toBani }: PublicLabourDto) {
    return this.i18n.t('garage.prices.labour', {
      range: formatWholeLeiRange(fromBani, toBani, this.i18n.language()),
    });
  }
}
