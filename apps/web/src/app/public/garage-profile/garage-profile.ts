import { HttpErrorResponse } from '@angular/common/http';
import {
  Component,
  computed,
  effect,
  inject,
  PendingTasks,
  RESPONSE_INIT,
  signal,
  untracked,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { EVENT_KINDS } from '@motor-fix/contracts/events';
import { GaragesService, type PublicGarageDto } from '@motor-fix/data-access';
import {
  DayPipe,
  formatRating,
  I18n,
  KmPipe,
  TranslatePipe,
} from '@motor-fix/i18n';
import { Lamp, RatingDial } from '@motor-fix/ui-cockpit';
import { map } from 'rxjs';

import { Gone } from './gone/gone';
import { LiveChange } from '../../dashboard/live-in-place/live-in-place';
import type { LiveView } from '../../live/view';
import { publicLiveResource } from '../live';

// What can change on a garage's page: the garage, its reviews, its
// verification, prices, mechanics and facilities.
const KINDS = EVENT_KINDS.filter(
  (kind) =>
    /^(garage|review|price_list|mechanic|facility)\./.test(kind) ||
    kind === 'verification.decided',
);

const GONE = [404, 410];

@Component({
  imports: [
    DayPipe,
    Gone,
    KmPipe,
    Lamp,
    LiveChange,
    RatingDial,
    RouterLink,
    TranslatePipe,
  ],
  selector: 'mf-garage-profile',
  styleUrl: './garage-profile.css',
  templateUrl: './garage-profile.html',
})
export class GarageProfile {
  private readonly route = inject(ActivatedRoute);
  private readonly garages = inject(GaragesService);
  private readonly pending = inject(PendingTasks);
  private readonly response = inject(RESPONSE_INIT, { optional: true });
  protected readonly i18n = inject(I18n);

  private readonly slug = toSignal(
    this.route.paramMap.pipe(map((params) => params.get('garage') ?? '')),
    { initialValue: '' },
  );
  private readonly brand = toSignal(
    this.route.queryParamMap.pipe(
      map((params) => params.get('brand') ?? undefined),
    ),
  );
  // The gone status last read, so a gone view knows 404 from 410; any other
  // failure leaves it as it was.
  private readonly status = signal<number | undefined>(undefined);

  protected readonly profile: LiveView<PublicGarageDto> = publicLiveResource(
    () => this.read(),
    KINDS,
    (): { garage?: string; brand?: string } => ({
      brand: this.profile?.value()?.brand?.id,
      garage: this.profile?.value()?.id,
    }),
  );
  protected readonly garage = this.profile.value;
  // What the dial says, announced politely when a re-read changes it.
  protected readonly ratingSaid = computed(() => {
    const rating = this.garage()?.rating;
    return typeof rating === 'number'
      ? this.i18n.t('shell.gauge.rating', {
          value: formatRating(rating, this.i18n.language()),
        })
      : this.i18n.t('shell.gauge.none');
  });
  protected readonly removed = computed(
    () => this.profile.gone() && this.status() === 410,
  );
  protected readonly unknown = computed(
    () => this.profile.gone() && this.status() !== 410,
  );

  constructor() {
    let first = true;
    effect(() => {
      this.slug();
      this.brand();
      if (first) {
        first = false;
        return;
      }
      untracked(() => this.profile.reload());
    });
    effect(() => {
      if (!this.response) return;
      if (this.removed()) this.response.status = 410;
      else if (this.unknown()) this.response.status = 404;
    });
  }

  // The server render waits for the first answer, so its status and its
  // content are the garage's.
  // A read the address moved away from while it ran is read again for the
  // address shown now, so a late answer never fills another garage's page.
  private read(): Promise<PublicGarageDto> {
    const slug = untracked(this.slug);
    const brand = untracked(this.brand);
    const moved = () =>
      slug !== untracked(this.slug) || brand !== untracked(this.brand);
    const done = this.pending.add();
    return this.garages
      .publicGaragesControllerBySlug({ slug, ...(brand ? { brand } : {}) })
      .then(
        (garage) => {
          if (moved()) return this.read();
          this.status.set(undefined);
          return garage;
        },
        (failure: unknown) => {
          if (moved()) return this.read();
          if (
            failure instanceof HttpErrorResponse &&
            GONE.includes(failure.status)
          )
            this.status.set(failure.status);
          throw failure;
        },
      )
      .finally(done);
  }
}
