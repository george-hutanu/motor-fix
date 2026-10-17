import { LiveAnnouncer } from '@angular/cdk/a11y';
import { isPlatformServer } from '@angular/common';
import {
  afterRenderEffect,
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  linkedSignal,
  PLATFORM_ID,
  resource,
  untracked,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { EVENT_KINDS, type EventKind } from '@motor-fix/contracts/events';
import {
  nearOf,
  parseNear,
  SEARCH_RADII,
  SEARCH_RADIUS_DEFAULT_KM,
} from '@motor-fix/contracts/search-place';
import {
  type GaragePinsDto,
  type GarageSearchControllerForBrand$Params,
  type GarageSearchPageDto,
  SearchService,
} from '@motor-fix/data-access';
import { I18n, TranslatePipe } from '@motor-fix/i18n';
import { Overlays } from '@motor-fix/overlays';
import { REDUCED_MOTION } from '@motor-fix/ui-cockpit';

import { ResultCard } from './result-card/result-card';
import { ResultsMap } from './results-map/results-map';
import { LiveChange, reuse } from '../../dashboard/live-in-place/live-in-place';
import { type Place, PlaceStore } from '../../home/place/place-store';
import { httpStatus } from '../../http-status';
import { followPublicView, PublicLive } from '../live';

// A link from a saved car names the brand by its id; every other one by slug.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const WIDE = SEARCH_RADII[1];
// A suspended card's fade, and the burst of events that makes one read.
const FADE_MS = 300;
const BURST_MS = 300;

const REVIEW_KINDS: readonly EventKind[] = EVENT_KINDS.filter((kind) =>
  kind.startsWith('review.'),
);
const REVIEWS: ReadonlySet<string> = new Set(REVIEW_KINDS);
// What may move a pin: a garage changed, gone, back or newly approved.
const PIN_KINDS: ReadonlySet<string> = new Set([
  'garage.updated',
  'garage.restored',
  'garage.suspended',
  'verification.decided',
]);
// What re-reads a loaded card: its reviews, its profile, its return.
const CARD_KINDS: ReadonlySet<string> = new Set([
  ...REVIEW_KINDS,
  'garage.updated',
  'garage.restored',
]);
const KINDS: readonly EventKind[] = [
  ...REVIEW_KINDS,
  'garage.updated',
  'garage.restored',
  'garage.suspended',
  'verification.decided',
];

type Page = GarageSearchPageDto;
type Query = Omit<GarageSearchControllerForBrand$Params, 'ids' | 'log'>;

const sameIds = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((id, i) => id === b[i]);

@Component({
  imports: [LiveChange, ResultCard, ResultsMap, RouterLink, TranslatePipe],
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
  private readonly live = inject(PublicLive);
  private readonly announcer = inject(LiveAnnouncer);
  private readonly reduced = inject(REDUCED_MOTION);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly i18n = inject(I18n);

  private readonly bar = toSignal(this.route.queryParamMap, {
    initialValue: this.route.snapshot.queryParamMap,
  });
  private readonly brand = computed(() => this.bar().get('brand') ?? '');
  // The place in the bar, else the one the browser keeps; a string, so the
  // bar catching up with the kept place starts no second search.
  protected readonly near = computed(() => {
    const near = this.bar().get('near');
    if (near) return near;
    const place = this.store.place();
    return place ? nearOf(place) : undefined;
  });
  private readonly radius = computed(() =>
    this.near() && this.bar().get('radius') === String(WIDE) ? WIDE : undefined,
  );

  // The box the driver moved the map to; never in the bar, and forgotten
  // when the bar names another search.
  protected readonly box = linkedSignal<unknown, string | undefined>({
    computation: () => undefined,
    source: () => [this.brand(), this.near(), this.radius()],
  });

  // The search the bar names, in the map's box once the driver moved it,
  // without what marks a single read.
  private readonly query = computed((): Query | undefined => {
    const brand = this.brand();
    if (this.server || !brand) return undefined;
    const near = this.near();
    const radius = this.radius();
    const bbox = this.box();
    return {
      ...(bbox ? { bbox } : {}),
      ...(UUID.test(brand) ? { brandId: brand } : { brand }),
      ...(near ? { near } : {}),
      ...(radius ? { radius } : {}),
    };
  });

  // Only a new search is logged: the opening one, another brand or place in
  // the bar, and a place chosen here; never a retry, a widening, a reload or
  // a move of the map.
  private logNext = false;
  private logged: string | undefined;

  // Never on the server: it renders the skeletons, the browser searches.
  protected readonly results = resource({
    loader: ({ params }) => {
      if (params.bbox)
        return this.search.garageSearchControllerForBrand(params);
      const searched = `${params.brand ?? params.brandId}|${params.near ?? ''}`;
      const log = this.logNext || searched !== this.logged;
      this.logNext = false;
      this.logged = searched;
      return this.search.garageSearchControllerForBrand(
        log ? { ...params, log: '1' } : params,
      );
    },
    params: () => this.query(),
  });

  // Every garage of the same search, for the map; never logged.
  protected readonly pins = resource({
    loader: ({ params }) => this.search.garageSearchControllerPins(params),
    params: () => this.query(),
  });
  // A box loading, or failed, leaves the pins the map shows where they are.
  protected readonly pinned = linkedSignal<
    { box: string | undefined; now: GaragePinsDto | undefined },
    GaragePinsDto | undefined
  >({
    computation: ({ box, now }, previous) =>
      now ?? (box ? previous?.value : undefined),
    source: () => ({
      box: this.box(),
      now: this.pins.hasValue() ? this.pins.value() : undefined,
    }),
  });
  // The grey map while the search runs; a box loading keeps the pins shown.
  protected readonly mapLoading = computed(
    () => !this.box() && (this.results.isLoading() || this.pins.isLoading()),
  );
  // The kept place where it is the one searched, else the bar's.
  protected readonly place = computed(() => {
    const near = this.near();
    const kept = this.store.place();
    if (kept && nearOf(kept) === near) return { lat: kept.lat, lng: kept.lng };
    return parseNear(near);
  });
  private readonly map = viewChild(ResultsMap);

  private readonly searched = computed(() =>
    this.results.isLoading() || !this.results.hasValue()
      ? undefined
      : this.results.value(),
  );
  // What the page shows: the search's answer, changed in place by the stream.
  protected readonly answer = linkedSignal<Page | undefined, Page | undefined>({
    computation: (page) => page,
    source: this.searched,
  });
  // The cards fading out, and whether the search has found more since.
  protected readonly leaving = linkedSignal<unknown, ReadonlySet<string>>({
    computation: () => new Set(),
    source: this.searched,
  });
  protected readonly newer = linkedSignal<unknown, boolean>({
    computation: () => false,
    source: this.searched,
  });
  private readonly loaded = computed(
    () => this.answer()?.items.map((garage) => garage.id) ?? [],
    { equal: sameIds },
  );

  protected readonly state = computed(() => {
    if (this.server || this.results.isLoading()) return 'loading';
    const answer = this.answer();
    if (answer) return answer.items.length === 0 ? 'empty' : 'list';
    // No brand, or one the catalogue does not hold: a retry would not help.
    if (!this.query() || httpStatus(this.results.error()) === 404)
      return 'missing';
    return 'failed';
  });

  // The 50 km search is offered once, near a place, before it has run.
  protected readonly widen = computed(() =>
    this.near() && !this.radius() && !this.box() ? WIDE : null,
  );
  protected readonly km = computed(
    () => this.radius() ?? SEARCH_RADIUS_DEFAULT_KM,
  );

  protected readonly skeletons = [0, 1, 2, 3, 4, 5];

  protected readonly tally = computed(() => {
    const answer = this.answer();
    if (!answer) return '';
    const brand = answer.brand.name;
    const found = this.box() ? 'public.results.inArea' : 'public.results.found';
    return [
      this.i18n.t(found, { count: answer.total }),
      this.i18n.t('public.results.takers', {
        brand,
        count: answer.counts.worksOn,
      }),
      this.i18n.t('public.results.others', {
        count: answer.counts.doesNotTake,
      }),
    ].join(' · ');
  });

  // The way back from the map's box to the search the bar names.
  protected readonly back = computed(() => {
    if (!this.box()) return null;
    return this.near()
      ? this.i18n.t('public.results.back', { km: this.km() })
      : this.i18n.t('public.results.backRomania');
  });

  // The kept place is named; a place only the bar knows is "the chosen place".
  protected readonly area = computed(() => {
    const near = this.near();
    if (!near || this.box()) return null;
    const km = this.km();
    const place = this.store.place();
    if (!place || nearOf(place) !== near) {
      return this.i18n.t('public.results.areaPicked', { km });
    }
    return place.label === null
      ? this.i18n.t('public.results.areaYou', { km })
      : this.i18n.t('public.results.area', { km, place: place.label });
  });

  // What the next read takes in: cards by id, the counts, the first page.
  private readonly wanted = new Set<string>();
  private countsWanted = false;
  private pageWanted = false;
  private pinsWanted = false;
  private reading = false;
  private burst: ReturnType<typeof setTimeout> | undefined;
  private readonly fades = new Set<ReturnType<typeof setTimeout>>();

  constructor() {
    if (this.server) return;
    // After the render, so the map holds the answer it frames; a live
    // re-read of the pins leaves the map where the driver has it.
    afterRenderEffect(() => {
      if (!this.pins.hasValue() || this.pins.isLoading() || this.box()) return;
      untracked(() => this.map()?.fit());
    });
    // The kept place goes into the bar, so the link shared opens this search.
    effect(() => {
      const kept = this.store.place();
      if (!kept || this.bar().get('near')) return;
      untracked(() => void this.write({ near: nearOf(kept) }));
    });
    followPublicView(() => ({
      brand: this.answer()?.brand.id,
      garages: this.loaded(),
    }));
    this.live
      .on(KINDS)
      .pipe(takeUntilDestroyed())
      .subscribe((message) => this.heard(message.kind, message.id));
    // The stream may have missed events while it was closed.
    this.live.resync.pipe(takeUntilDestroyed()).subscribe(() => {
      if (!untracked(this.answer)) return;
      for (const id of untracked(this.loaded)) this.wanted.add(id);
      this.countsWanted = true;
      this.pinsWanted = true;
      void this.flush();
    });
    this.destroyRef.onDestroy(() => {
      clearTimeout(this.burst);
      for (const fade of this.fades) clearTimeout(fade);
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
    if (nearOf(place) !== this.near() || this.radius()) this.logNext = true;
    this.store.set(place);
    await this.write({ near: nearOf(place), radius: null });
  }

  protected retry() {
    this.results.reload();
    if (this.pins.error()) this.pins.reload();
  }

  // A box the map settled on; the same one again retries it after a failure.
  protected move(bbox: string) {
    if (bbox !== untracked(this.box)) return this.box.set(bbox);
    if (!this.results.error() && !this.pins.error()) return;
    this.results.reload();
    this.pins.reload();
  }

  protected backToSearch() {
    this.box.set(undefined);
  }

  protected widenTo(radius: number) {
    void this.write({ radius: String(radius) });
  }

  // "Reîncarcă": the first page again, in place of the list shown.
  protected reload() {
    this.newer.set(false);
    this.pageWanted = true;
    void this.flush();
  }

  private heard(kind: string, id: string) {
    const page = untracked(this.answer);
    if (!page) return;
    const loaded = page.items.some((garage) => garage.id === id);
    if (PIN_KINDS.has(kind)) this.pinsWanted = true;
    // A suspended card fades out; the counts come from a re-read, which never
    // holds it, so one already re-read after the suspension is not lowered twice.
    if (kind === 'garage.suspended' && loaded) {
      this.leave(id);
      this.countsWanted = true;
    } else if (CARD_KINDS.has(kind) && loaded) this.wanted.add(id);
    // A review names itself, not its garage; only loaded garages send them.
    else if (REVIEWS.has(kind))
      for (const garage of page.items) this.wanted.add(garage.id);
    else this.countsWanted = true;
    clearTimeout(this.burst);
    this.burst = setTimeout(() => void this.flush(), BURST_MS);
  }

  // One read at a time; what arrives during a read is read after it.
  private async flush() {
    if (this.reading) return;
    this.reading = true;
    try {
      let more = true;
      while (more) more = await this.readNext();
    } finally {
      this.reading = false;
    }
  }

  // The next read wanted, the pins first; false once nothing is.
  private async readNext() {
    if (this.pinsWanted) {
      this.pinsWanted = false;
      await this.readPins();
    } else if (this.pageWanted) {
      this.pageWanted = false;
      this.wanted.clear();
      this.countsWanted = false;
      await this.read(undefined, (page, now) => reuse(now, page));
    } else if (this.wanted.size > 0) {
      const ids = [...this.wanted].join(',');
      this.wanted.clear();
      await this.read(ids, (page, now) =>
        this.counted(page, this.withCards(page, now)),
      );
    } else if (this.countsWanted) {
      this.countsWanted = false;
      await this.read(undefined, (page, now) => this.counted(page, now));
    } else return false;
    return true;
  }

  // A read that fails keeps the page as it is; one answered after the search
  // changed is dropped.
  private async read(
    ids: string | undefined,
    apply: (page: Page, now: Page) => Page,
  ) {
    const query = untracked(this.query);
    if (!query) return;
    let page: Page;
    try {
      page = await this.search.garageSearchControllerForBrand({
        ...query,
        ...(ids ? { ids } : {}),
      });
    } catch {
      return;
    }
    const now = untracked(this.answer);
    if (this.destroyRef.destroyed || !now || untracked(this.query) !== query)
      return;
    this.answer.set(apply(page, now));
  }

  // Like a card's read: a failure keeps the pins shown, a late answer is dropped.
  private async readPins() {
    const query = untracked(this.query);
    if (!query) return;
    let pins: GaragePinsDto;
    try {
      pins = await this.search.garageSearchControllerPins(query);
    } catch {
      return;
    }
    if (this.destroyRef.destroyed || untracked(this.query) !== query) return;
    this.pinned.set(pins);
  }

  // The cards read again replace theirs where they stand; the order holds.
  private withCards(page: Page, now: Page): Page {
    const fresh = new Map(page.items.map((garage) => [garage.id, garage]));
    const items = now.items.map((garage) =>
      reuse(garage, fresh.get(garage.id) ?? garage),
    );
    return items.every((garage, i) => garage === now.items[i])
      ? now
      : { ...now, items };
  }

  // More found waits behind "Reîncarcă"; fewer, or another split, shows.
  private counted(page: Page, now: Page): Page {
    if (page.total > now.total) {
      this.newer.set(true);
      return now;
    }
    this.newer.set(false);
    const counts = reuse(now.counts, page.counts);
    return counts === now.counts && page.total === now.total
      ? now
      : { ...now, counts, total: page.total };
  }

  private leave(id: string) {
    const garage = untracked(this.answer)?.items.find((g) => g.id === id);
    if (!garage || untracked(this.leaving).has(id)) return;
    void this.announcer.announce(
      this.i18n.t('public.results.live.removed', { name: garage.name }),
      'polite',
    );
    if (untracked(this.reduced)) return this.drop(id);
    this.leaving.update((ids) => new Set(ids).add(id));
    const fade = setTimeout(() => {
      this.fades.delete(fade);
      this.drop(id);
    }, FADE_MS);
    this.fades.add(fade);
  }

  private drop(id: string) {
    this.leaving.update((ids) => new Set([...ids].filter((i) => i !== id)));
    const now = untracked(this.answer);
    const garage = now?.items.find((g) => g.id === id);
    if (!now || !garage) return;
    this.answer.set({ ...now, items: now.items.filter((g) => g.id !== id) });
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
