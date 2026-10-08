import { DOCUMENT, isPlatformServer } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import {
  afterNextRender,
  Component,
  computed,
  effect,
  inject,
  linkedSignal,
  makeStateKey,
  PendingTasks,
  PLATFORM_ID,
  resource,
  signal,
  TransferState,
  untracked,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { nearOf } from '@motor-fix/contracts/search-place';
import {
  type BrandDto,
  BrandsService,
  type HealthReadyDto,
  HealthService,
  HomeService,
  PlacesService,
} from '@motor-fix/data-access';
import { I18n, TranslatePipe } from '@motor-fix/i18n';
import { Overlays } from '@motor-fix/overlays';
import { REDUCED_MOTION } from '@motor-fix/ui-cockpit';

import { BrandPicker } from './brand-picker/brand-picker';
import { BrandSearch } from './brand-picker/brand-search/brand-search';
import { type Place, PlaceStore } from './place/place-store';
import { Session } from '../dashboard/session';

export const HEALTH = makeStateKey<HealthReadyDto | null>('health');
export const TILES = makeStateKey<BrandDto[] | null>('tiles');

const CYCLE_MS = 5000;

// A 503 from the ready check still carries the report, so it is shown, not
// treated as "unknown".
const report = (error: unknown) =>
  error instanceof HttpErrorResponse && error.error?.checks
    ? (error.error as HealthReadyDto)
    : null;

@Component({
  imports: [BrandPicker, BrandSearch, RouterLink, TranslatePipe],
  selector: 'mf-home',
  styleUrl: './home.css',
  templateUrl: './home.html',
})
export class Home {
  private readonly state = inject(TransferState);
  private readonly server = isPlatformServer(inject(PLATFORM_ID));
  private readonly document = inject(DOCUMENT);
  private readonly reduced = inject(REDUCED_MOTION);
  private readonly homes = inject(HomeService);
  private readonly overlays = inject(Overlays);
  private readonly session = inject(Session);
  private readonly places = inject(PlacesService);
  private readonly store = inject(PlaceStore);
  protected readonly place = this.store.place;
  // Bumped by a place chosen here, so a Setări city answering later never
  // replaces it.
  private chosen = 0;
  private cityAsked: string | null = null;
  protected readonly i18n = inject(I18n);
  protected readonly health = signal(this.state.get(HEALTH, null));
  protected readonly tiles = signal(this.state.get(TILES, null) ?? []);
  private readonly searched = signal<BrandDto | undefined>(undefined);
  protected readonly shown = computed(() => {
    const searched = this.searched();
    return searched ? [searched, ...this.tiles().slice(0, 7)] : this.tiles();
  });
  protected readonly selected = linkedSignal<BrandDto | undefined>(
    () => this.tiles()[0],
  );
  // Until a person reaches for the picker the brand changes on its own, and
  // a screen reader is not told each time.
  protected readonly touched = signal(false);
  private readonly hydrated = signal(false);

  // The count is never read on the server: the page there carries the tiles,
  // and the browser asks once per brand it shows.
  protected readonly home = resource({
    loader: ({ params }) => this.homes.homeControllerForBrand(params),
    params: () => {
      const brand = this.selected()?.slug;
      if (this.server || !brand) return undefined;
      const place = this.place();
      return place ? { brand, near: nearOf(place) } : { brand };
    },
  });
  protected readonly busy = computed(
    () => this.server || this.home.isLoading(),
  );
  protected readonly count = computed(() => {
    if (this.home.isLoading() || !this.home.hasValue()) return null;
    const { brand, takers, total } = this.home.value();
    return this.i18n.t('public.home.count', {
      brand: brand.name,
      count: total,
      takers,
      verb: this.i18n.t('public.home.takes', { count: takers }),
    });
  });

  protected readonly checks = computed(() => {
    const checks = this.health()?.checks;
    const unknown = this.i18n.t('shell.health.unknown');
    return {
      postgres: checks?.postgres ?? unknown,
      redis: checks?.redis ?? unknown,
    };
  });

  constructor() {
    afterNextRender(() => {
      this.hydrated.set(true);
    });
    // Public pages never ask for the session (each ask renews the cookie), so
    // the Setări city is taken only once some other screen has loaded it.
    effect(() => {
      const city = this.session.current()?.city;
      if (!this.hydrated() || !city || city === this.cityAsked) return;
      this.cityAsked = city;
      untracked(() => {
        if (!this.place()) void this.fromCity(city);
      });
    });
    effect((onCleanup) => {
      if (!this.hydrated() || this.touched() || this.reduced()) return;
      if (this.tiles().length < 2) return;
      const timer = setInterval(() => {
        if (!this.document.hidden) this.advance();
      }, CYCLE_MS);
      onCleanup(() => clearInterval(timer));
    });

    const brands = inject(BrandsService);
    if (!this.server) {
      // Opened from another screen in the app: no server render handed the
      // tiles over, so the browser reads them itself.
      if (!this.state.hasKey(TILES)) {
        void brands
          .popularBrandsControllerTiles({ limit: 8 })
          .catch(() => [])
          .then((tiles) => this.tiles.set(tiles));
      }
      return;
    }
    const health = inject(HealthService);
    const pending = inject(PendingTasks);
    void pending.run(async () => {
      const ready = await health.healthControllerReady().catch(report);
      this.health.set(ready);
      this.state.set(HEALTH, ready);
    });
    void pending.run(async () => {
      const tiles = await brands
        .popularBrandsControllerTiles({ limit: 8 })
        .catch(() => []);
      this.tiles.set(tiles);
      this.state.set(TILES, tiles);
    });
  }

  protected async pickPlace() {
    // Loaded on the first tap: the dialog stays out of the initial bundle.
    const { PlaceDialog } = await import('./place/place-dialog/place-dialog');
    const place = await this.overlays.open<Place>(PlaceDialog, {
      confirmDiscard: false,
      shape: 'dialog',
      title: 'public.home.place.title',
    });
    if (place === 'cancelled') return;
    this.chosen++;
    this.store.set(place);
  }

  // A driver who saved a city in Setări starts near it; a failed or empty
  // look-up leaves all of Romania, saying nothing.
  private async fromCity(city: string) {
    const chosen = this.chosen;
    const items = await this.places
      .placesControllerSearch({ lang: this.i18n.language(), q: city })
      .then((answer) => answer.items)
      .catch(() => []);
    const [first] = items;
    if (!first || chosen !== this.chosen || this.place()) return;
    this.store.use({
      label: city,
      lat: first.lat,
      lng: first.lng,
      origin: 'address',
    });
  }

  protected choose(slug: string) {
    this.selected.set(this.shown().find((brand) => brand.slug === slug));
  }

  protected pick(brand: BrandDto) {
    if (brand.slug === this.selected()?.slug) return;
    // A tile counts only while it is shown: a popular brand an earlier search
    // pushed off the eight takes the first place like any other.
    const tile = this.shown().find((b) => b.slug === brand.slug);
    if (!tile) this.searched.set(brand);
    this.selected.set(tile ?? brand);
  }

  private advance() {
    const tiles = this.shown();
    const at = tiles.findIndex((b) => b.slug === this.selected()?.slug);
    this.selected.set(tiles[(at + 1) % tiles.length]);
  }
}
