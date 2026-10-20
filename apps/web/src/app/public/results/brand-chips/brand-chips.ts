import { isPlatformBrowser } from '@angular/common';
import {
  afterRenderEffect,
  Component,
  computed,
  type ElementRef,
  inject,
  input,
  output,
  PLATFORM_ID,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import {
  type BrandDto,
  BrandsService,
  CarsService,
} from '@motor-fix/data-access';
import { TranslatePipe } from '@motor-fix/i18n';

import { type Chip, chipRow, ROW } from './chip-row';
import { Session } from '../../../dashboard/session';
import { publicRead } from '../../../public-read';

// The answer's brand reference or a brand the search found.
type Brand = Pick<BrandDto, 'id' | 'name' | 'slug'>;

const chipOf = ({ id, name, slug }: Brand): Chip => ({ id, name, slug });

// The brand a tap asks for: its slug, or its id, and the name to say.
export type BrandPick = { key: string; name: string };

// The brands a search can switch to without leaving Results: the driver's
// own, the current one, then the popular ones. Tapping one hands its slug
// (or its id) and its name to the page; the marked one hands nothing.
@Component({
  imports: [TranslatePipe],
  selector: 'mf-brand-chips',
  styleUrl: './brand-chips.css',
  templateUrl: './brand-chips.html',
})
export class BrandChips {
  private readonly brands = inject(BrandsService);
  private readonly cars = inject(CarsService);
  private readonly session = inject(Session);

  // The bar's brand, by slug or id; the brand the answer names; the brand
  // last picked in the search beside the row.
  readonly brand = input.required<string>();
  readonly answered = input<Brand>();
  readonly picked = input<Brand>();
  readonly pick = output<BrandPick>();

  private readonly own = signal<Chip[]>([]);
  private readonly popular = signal<Chip[]>([]);
  // Until the reads behind the row settle, the current brand shows alone.
  private readonly read = signal(false);

  private readonly matches = (brand: Brand | undefined) => {
    const bar = this.brand();
    return brand && (brand.slug === bar || brand.id === bar)
      ? brand
      : undefined;
  };
  private readonly current = computed(() => {
    const brand = this.matches(this.picked()) ?? this.matches(this.answered());
    return brand ? chipOf(brand) : undefined;
  });
  protected readonly row = computed(() =>
    this.read()
      ? chipRow(this.current(), this.own(), this.popular())
      : chipRow(this.current(), [], []),
  );
  protected readonly marked = computed(() => {
    const bar = this.brand();
    const current = this.current();
    return this.row().find(
      (chip) => chip.slug === bar || chip.id === bar || chip.id === current?.id,
    )?.id;
  });

  private readonly list = viewChild<ElementRef<HTMLElement>>('list');

  constructor() {
    if (isPlatformBrowser(inject(PLATFORM_ID))) void this.load();
    // On a phone the row scrolls: the marked chip is brought inside it,
    // without moving the page.
    afterRenderEffect(() => {
      const id = this.marked();
      const list = this.list()?.nativeElement;
      if (!id || !list) return;
      const chip = [...list.querySelectorAll<HTMLElement>('.chip')].find(
        (button) => button.dataset['id'] === id,
      );
      if (!chip) return;
      const start = chip.offsetLeft;
      const end = start + chip.offsetWidth;
      const width = list.clientWidth;
      if (start < list.scrollLeft) list.scrollLeft = start;
      else if (end > list.scrollLeft + width) list.scrollLeft = end - width;
    });
  }

  protected tap(chip: Chip) {
    if (chip.id === untracked(this.marked)) return;
    this.pick.emit({ key: chip.slug ?? chip.id, name: chip.name });
  }

  // Both reads at once; a failure adds nothing and asks nobody to sign in.
  private async load() {
    const [popular, own] = await Promise.all([
      this.brands
        .popularBrandsControllerTiles({ limit: ROW }, publicRead())
        .then((list) => list.map(chipOf))
        .catch(() => []),
      this.ownBrands(),
    ]);
    this.popular.set(popular);
    this.own.set(own);
    this.read.set(true);
  }

  // A visitor's page asks nobody; a browser last seen as a driver confirms
  // its session first.
  private async ownBrands(): Promise<Chip[]> {
    const role = this.session.current()?.role ?? this.session.roleHint();
    if (role !== 'driver') return [];
    try {
      const me = await this.session.load({ keepLanguage: true });
      if (me?.role !== 'driver') return [];
      const { items } = await this.cars.carsControllerList();
      return items.map((car) => ({ id: car.brandId, name: car.brandName }));
    } catch {
      return [];
    }
  }
}
