import { isPlatformBrowser } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import {
  afterNextRender,
  Component,
  computed,
  effect,
  inject,
  PendingTasks,
  PLATFORM_ID,
  RESPONSE_INIT,
  signal,
  untracked,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
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

import { EstimateBar } from './estimate-bar/estimate-bar';
import { EstimateSection } from './estimate-section/estimate-section';
import { Gone } from './gone/gone';
import { PhotosSection } from './photos-section/photos-section';
import { PriceSelection } from './price-selection/price-selection';
import { PricesSection } from './prices-section/prices-section';
import { ReportGarageLink } from './report-garage-link/report-garage-link';
import { RequestQuoteButton } from './request-quote-button/request-quote-button';
import { sourceOf } from './view-source';
import { Consent } from '../../consent/consent';
import { LiveChange } from '../../dashboard/live-in-place/live-in-place';
import type { LiveView } from '../../live/view';
import { publicRead } from '../../public-read';
import { publicLiveResource } from '../live';
import { ProfilePrefetch } from '../profile-prefetch/profile-prefetch';
import { SaveGarageButton } from '../saved-garages/save-garage-button/save-garage-button';
import { SavedGarages } from '../saved-garages/saved-garages';

// What can change on a garage's page: the garage, its reviews, its
// verification, prices, mechanics, facilities and response figures.
const KINDS = EVENT_KINDS.filter(
  (kind) =>
    /^(garage|review|price_list|mechanic|facility)\./.test(kind) ||
    kind === 'verification.decided' ||
    kind === 'response_stats.updated',
);

const GONE = [404, 410];

// The analytics name of where a profile was opened from; a direct open has none.
const OPENED_FROM: Partial<Record<ReturnType<typeof sourceOf>, string>> = {
  home: 'home',
  saved: 'saved_list',
  search: 'results',
  shared_link: 'shared_link',
};

@Component({
  imports: [
    DayPipe,
    EstimateBar,
    EstimateSection,
    Gone,
    KmPipe,
    Lamp,
    LiveChange,
    PhotosSection,
    PricesSection,
    RatingDial,
    ReportGarageLink,
    RequestQuoteButton,
    SaveGarageButton,
    RouterLink,
    TranslatePipe,
  ],
  providers: [PriceSelection],
  selector: 'mf-garage-profile',
  styleUrl: './garage-profile.css',
  templateUrl: './garage-profile.html',
})
export class GarageProfile {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly browser = isPlatformBrowser(inject(PLATFORM_ID));
  private readonly garages = inject(GaragesService);
  private readonly consent = inject(Consent);
  private readonly pending = inject(PendingTasks);
  private readonly response = inject(RESPONSE_INIT, { optional: true });
  private readonly prefetch = inject(ProfilePrefetch);
  private readonly saved = inject(SavedGarages);
  private readonly selection = inject(PriceSelection);
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
  // A pre-fetched answer stands in for the first read; the stream's messages
  // read again as on any other open.
  private prefetched: PublicGarageDto | undefined;

  protected readonly profile: LiveView<PublicGarageDto> = publicLiveResource(
    () => this.read(),
    KINDS,
    (): { garage?: string; brand?: string } => ({
      brand: this.profile?.value()?.brand?.id,
      garage: this.profile?.value()?.id,
    }),
    undefined,
    this.takePrefetched(),
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
  // Empty when the garage has had no request to count lately: no line.
  protected readonly rateSaid = computed(() => {
    const response = this.garage()?.responseRate;
    if (response?.state === 'rate' && response.rate !== undefined) {
      return this.i18n.t('public.garageProfile.rate', { rate: response.rate });
    }
    return response?.state === 'new'
      ? this.i18n.t('public.garageProfile.newGarage')
      : '';
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
    let viewed: string | undefined;
    effect(() => {
      const id = this.garage()?.id;
      if (!this.browser || !id || id === viewed) return;
      viewed = id;
      untracked(() => {
        this.view(id);
        // Which garages a driver saved, once per profile opened.
        void this.saved.load();
      });
    });
    // The jobs switched on follow every answer read. In the browser the
    // first answer waits for the first render, so the jobs kept for the
    // session come back after hydration rather than into it.
    let rendered = !this.browser;
    effect(() => {
      const garage = this.garage();
      if (garage && rendered) untracked(() => this.selection.sync(garage));
    });
    if (this.browser) {
      afterNextRender(() => {
        rendered = true;
        const garage = untracked(this.garage);
        if (garage) this.selection.sync(garage);
      });
    }
    // The garage's own purge tag, so its edit clears this page at the edge.
    effect(() => {
      if (!this.response) return;
      const id = this.garage()?.id;
      if (id) {
        // Added to the render's own headers, which carry its content type.
        const headers = new Headers(this.response.headers);
        headers.set('CDN-Tag', `garage:${id}`);
        this.response.headers = headers;
      }
      if (this.removed()) this.response.status = 410;
      else if (this.unknown()) this.response.status = 404;
    });
  }

  // A profile pre-fetched from the results, shown at once; after a server
  // render the transfer cache answers the first read instead.
  private takePrefetched(): PublicGarageDto | undefined {
    if (!this.browser) return undefined;
    this.prefetched = this.prefetch.take(
      untracked(this.slug),
      untracked(this.brand),
    );
    return this.prefetched;
  }

  // One view per garage opened, sent once it is known to be there and never
  // waited on: a refused or lost view leaves the page as it is.
  private view(id: string): void {
    const before = this.router.lastSuccessfulNavigation()?.previousNavigation;
    const source = sourceOf(
      before
        ? this.router.serializeUrl(before.finalUrl ?? before.initialUrl)
        : undefined,
      this.route.snapshot.queryParamMap.get('src'),
    );
    this.garages
      .profileViewsControllerRecord({ body: { source }, id })
      .catch(() => undefined);
    const opened = OPENED_FROM[source];
    this.consent.track('garage_opened', opened ? { source: opened } : {});
  }

  // The server render waits for the first answer, so its status and its
  // content are the garage's.
  // A read the address moved away from while it ran is read again for the
  // address shown now, so a late answer never fills another garage's page.
  private read(): Promise<PublicGarageDto> {
    const prefetched = this.prefetched;
    this.prefetched = undefined;
    if (prefetched) return Promise.resolve(prefetched);
    const slug = untracked(this.slug);
    const brand = untracked(this.brand);
    const moved = () =>
      slug !== untracked(this.slug) || brand !== untracked(this.brand);
    const done = this.pending.add();
    return this.garages
      .publicGaragesControllerBySlug(
        { slug, ...(brand ? { brand } : {}) },
        publicRead(),
      )
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
