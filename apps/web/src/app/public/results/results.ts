import { isPlatformServer } from '@angular/common';
import {
  Component,
  computed,
  effect,
  inject,
  PLATFORM_ID,
  resource,
  untracked,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import {
  nearOf,
  SEARCH_RADIUS_DEFAULT_KM,
} from '@motor-fix/contracts/search-place';
import {
  type GarageSearchControllerForBrand$Params,
  SearchService,
} from '@motor-fix/data-access';
import { I18n, TranslatePipe } from '@motor-fix/i18n';
import { Overlays } from '@motor-fix/overlays';

import { ResultCard } from './result-card/result-card';
import { type Place, PlaceStore } from '../../home/place/place-store';

// A link from a saved car names the brand by its id; every other one by slug.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const WIDE = 50;

@Component({
  imports: [ResultCard, TranslatePipe],
  selector: 'mf-results',
  styleUrl: './results.css',
  templateUrl: './results.html',
})
export class Results {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly server = isPlatformServer(inject(PLATFORM_ID));
  private readonly search = inject(SearchService);
  private readonly overlays = inject(Overlays);
  private readonly store = inject(PlaceStore);
  protected readonly i18n = inject(I18n);

  private readonly bar = toSignal(this.route.queryParamMap, {
    initialValue: this.route.snapshot.queryParamMap,
  });
  private readonly brand = computed(() => this.bar().get('brand') ?? '');
  // The place in the bar, else the one the browser keeps; a string, so the
  // bar catching up with the kept place starts no second search.
  private readonly near = computed(() => {
    const near = this.bar().get('near');
    if (near) return near;
    const place = this.store.place();
    return place ? nearOf(place) : undefined;
  });
  private readonly radius = computed(() =>
    this.near() && this.bar().get('radius') === String(WIDE) ? WIDE : undefined,
  );

  // Never on the server: it renders the skeletons, the browser searches.
  protected readonly results = resource({
    loader: ({ params }) => this.search.garageSearchControllerForBrand(params),
    params: (): GarageSearchControllerForBrand$Params | undefined => {
      const brand = this.brand();
      if (this.server || !brand) return undefined;
      const near = this.near();
      const radius = this.radius();
      return {
        ...(UUID.test(brand) ? { brandId: brand } : { brand }),
        log: '1',
        ...(near ? { near } : {}),
        ...(radius ? { radius } : {}),
      };
    },
  });

  protected readonly answer = computed(() =>
    this.results.isLoading() || !this.results.hasValue()
      ? undefined
      : this.results.value(),
  );

  // 'empty' and 'failed' draw no block of their own yet.
  protected readonly state = computed(() => {
    if (this.server || this.results.isLoading()) return 'loading';
    const answer = this.answer();
    if (!answer) return 'failed';
    return answer.items.length === 0 ? 'empty' : 'list';
  });

  protected readonly skeletons = [0, 1, 2, 3, 4, 5];

  protected readonly tally = computed(() => {
    const answer = this.answer();
    if (!answer) return '';
    const brand = answer.brand.name;
    return [
      this.i18n.t('public.results.found', { count: answer.total }),
      this.i18n.t('public.results.takers', {
        brand,
        count: answer.counts.worksOn,
      }),
      this.i18n.t('public.results.others', {
        count: answer.counts.doesNotTake,
      }),
    ].join(' · ');
  });

  // The kept place is named; a place only the bar knows is "the chosen place".
  protected readonly area = computed(() => {
    const near = this.near();
    if (!near) return null;
    const km = this.radius() ?? SEARCH_RADIUS_DEFAULT_KM;
    const place = this.store.place();
    if (!place || nearOf(place) !== near) {
      return this.i18n.t('public.results.areaPicked', { km });
    }
    return place.label === null
      ? this.i18n.t('public.results.areaYou', { km })
      : this.i18n.t('public.results.area', { km, place: place.label });
  });

  constructor() {
    if (this.server) return;
    // The kept place goes into the bar, so the link shared opens this search.
    effect(() => {
      const kept = this.store.place();
      if (!kept || this.bar().get('near')) return;
      untracked(() => void this.write({ near: nearOf(kept) }));
    });
  }

  protected async changePlace() {
    // Loaded on the first tap: the dialog stays out of the page's bundle.
    const { PlaceDialog } = await import(
      '../../home/place/place-dialog/place-dialog'
    );
    const place = await this.overlays.open<Place>(PlaceDialog, {
      confirmDiscard: false,
      shape: 'dialog',
      title: 'public.home.place.title',
    });
    if (place === 'cancelled') return;
    this.store.set(place);
    await this.write({ near: nearOf(place), radius: null });
  }

  private write(queryParams: Record<string, string | null>) {
    return this.router.navigate([], {
      queryParams,
      queryParamsHandling: 'merge',
      relativeTo: this.route,
      replaceUrl: true,
    });
  }
}
