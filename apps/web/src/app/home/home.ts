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
} from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  type BrandDto,
  BrandsService,
  type HealthReadyDto,
  HealthService,
  HomeService,
} from '@motor-fix/data-access';
import { I18n, LanguageSwitch, TranslatePipe } from '@motor-fix/i18n';
import { REDUCED_MOTION } from '@motor-fix/ui-cockpit';

import { BrandPicker } from './brand-picker/brand-picker';
import { BrandSearch } from './brand-picker/brand-search/brand-search';

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
  imports: [
    BrandPicker,
    BrandSearch,
    LanguageSwitch,
    RouterLink,
    TranslatePipe,
  ],
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
  protected readonly i18n = inject(I18n);
  protected readonly health = signal(this.state.get(HEALTH, null));
  protected readonly tiles = signal(this.state.get(TILES, null) ?? []);
  // A brand found by search takes the first tile while the visitor stays on
  // Home; the popular tiles after it keep their order.
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
    loader: ({ params }) =>
      this.homes.homeControllerForBrand({ brand: params }),
    params: () => (this.server ? undefined : this.selected()?.slug),
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
    afterNextRender(() => this.hydrated.set(true));
    effect((onCleanup) => {
      if (!this.hydrated() || this.touched() || this.reduced()) return;
      if (this.tiles().length < 2) return;
      const timer = setInterval(() => {
        if (!this.document.hidden) this.advance();
      }, CYCLE_MS);
      onCleanup(() => clearInterval(timer));
    });

    if (!this.server) return;
    const health = inject(HealthService);
    const brands = inject(BrandsService);
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

  protected choose(slug: string) {
    this.selected.set(this.shown().find((brand) => brand.slug === slug));
  }

  protected pick(brand: BrandDto) {
    if (brand.slug === this.selected()?.slug) return;
    const tile = this.tiles().find((b) => b.slug === brand.slug);
    if (!tile) this.searched.set(brand);
    this.selected.set(tile ?? brand);
  }

  private advance() {
    const tiles = this.shown();
    const at = tiles.findIndex((b) => b.slug === this.selected()?.slug);
    this.selected.set(tiles[(at + 1) % tiles.length]);
  }
}
