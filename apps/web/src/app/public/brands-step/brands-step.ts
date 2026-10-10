import { isPlatformServer } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  inject,
  input,
  model,
  output,
  PLATFORM_ID,
  signal,
} from '@angular/core';
import type { PriceEntry } from '@motor-fix/contracts/listing-sections';
import {
  FUELS,
  NOTE_MAX,
  PHRASE_MAX,
} from '@motor-fix/contracts/marked-brands';
import {
  type BrandDto,
  BrandsService,
  type JobTypeDto,
} from '@motor-fix/data-access';
import { I18n, TranslatePipe } from '@motor-fix/i18n';
import { HlmButton, HlmInput, HlmLabel, Lamp } from '@motor-fix/ui-cockpit';

import {
  type BrandsSection,
  clean,
  counts,
  cut,
  type Fuel,
  fuelsOf,
  type Job,
  jobsOf,
  letters,
  mark,
  next,
  refOf,
  type Stance,
  tickAll,
  toggleFuel,
  toggleJob,
  untickedOf,
} from '../brands-section';
import { jobName } from '../prices-step/prices-rows';

const POPULAR = 12;
// The search waits for the owner to stop typing.
const DEBOUNCE_MS = 250;

type Brand = Pick<BrandDto, 'id' | 'name'>;
type Text = 'brandNote' | 'refusalPhrase';
type JobName = Pick<JobTypeDto, 'nameEn' | 'nameRo'>;

// Step 2 of listing a garage: each brand taken, refused or left off, plus a
// short note and a refusal phrase. It holds the draft's section and saves
// nothing.
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [HlmButton, HlmInput, HlmLabel, Lamp, TranslatePipe],
  selector: 'mf-brands-step',
  styleUrl: './brands-step.css',
  templateUrl: './brands-step.html',
})
export class BrandsStep {
  private readonly i18n = inject(I18n);
  private readonly catalogue = inject(BrandsService);
  private readonly limits: Record<Text, number> = {
    brandNote: NOTE_MAX,
    refusalPhrase: PHRASE_MAX,
  };
  private timer: ReturnType<typeof setTimeout> | undefined;
  private searches = 0;

  readonly value = model<BrandsSection>({ brands: [] });
  // The ids of the popular and searched brands, in the order the chips show them.
  readonly order = output<string[]>();
  // The price list's entries from step 3, and the catalogue names of its jobs.
  readonly jobs = input<readonly PriceEntry[]>([]);
  readonly jobNames = input<ReadonlyMap<string, JobName>>(new Map());
  // The step the owner asks to open.
  readonly goTo = output<number>();

  protected readonly fuelList = FUELS;
  protected readonly refOf = refOf;
  protected readonly jobList = computed(() => jobsOf(this.jobs()));
  protected readonly note: Text = 'brandNote';
  protected readonly phrase: Text = 'refusalPhrase';

  private readonly popular = signal<Brand[]>([]);
  // Brands brought in by search stay as chips after they are switched off.
  private readonly added = signal<Brand[]>([]);
  protected readonly query = signal('');
  protected readonly results = signal<Brand[]>([]);
  protected readonly notice = signal<string | null>(null);

  protected readonly chips = computed(() => {
    const shown = [...this.popular(), ...this.added()];
    const restored = this.value()
      .brands.filter((b) => !shown.some((s) => s.id === b.brandId))
      .map((b) => ({ id: b.brandId, name: b.name }));
    return [...shown, ...restored];
  });

  protected readonly counter = computed(() => {
    const { refused, taken } = counts(this.value().brands);
    return this.i18n.t('public.listing.brands.counter', {
      refused: this.i18n.t('public.listing.brands.refused', { count: refused }),
      taken: this.i18n.t('public.listing.brands.taken', { count: taken }),
    });
  });

  constructor() {
    let gone = false;
    inject(DestroyRef).onDestroy(() => {
      gone = true;
      clearTimeout(this.timer);
    });
    // The chips come with the client: a server render would drop the answer.
    if (isPlatformServer(inject(PLATFORM_ID))) return;
    this.catalogue.brandsControllerSearch({}).then(
      (page) => {
        this.popular.set(page.items.slice(0, POPULAR));
        if (!gone) this.tellOrder();
      },
      () => this.notice.set('public.listing.brands.searchDown'),
    );
  }

  private tellOrder() {
    this.order.emit([...this.popular(), ...this.added()].map((b) => b.id));
  }

  protected input(event: Event) {
    return event.target as HTMLInputElement;
  }

  protected stanceOf(id: string): Stance | undefined {
    return this.value().brands.find((b) => b.brandId === id)?.stance;
  }

  // The fuels of a taken brand; none for one refused or not marked.
  protected fuelsTicked(id: string): Fuel[] | null {
    const held = this.value().brands.find((b) => b.brandId === id);
    return held?.stance === 'works_on' ? fuelsOf(held) : null;
  }

  protected fuelKey(fuel: Fuel) {
    return `public.listing.brands.fuel.${fuel}`;
  }

  protected tickFuel(id: string, fuel: Fuel) {
    this.value.update((v) => ({
      ...v,
      brands: toggleFuel(v.brands, id, fuel),
    }));
  }

  protected jobLabel(job: Job) {
    return jobName(job, this.jobNames(), this.i18n.language());
  }

  protected untickedFor(id: string): string[] {
    const held = this.value().brands.find((b) => b.brandId === id);
    return held ? untickedOf(held) : [];
  }

  protected jobsTicked(id: string) {
    const off = this.untickedFor(id);
    return this.jobList().filter((job) => !off.includes(refOf(job))).length;
  }

  // Nothing reaches a taken brand with every fuel or every job unticked.
  protected getsNothing(id: string, fuels: Fuel[]) {
    return !fuels.length || (this.jobList().length > 0 && !this.jobsTicked(id));
  }

  protected tickJob(id: string, ref: string) {
    this.value.update((v) => ({ ...v, brands: toggleJob(v.brands, id, ref) }));
  }

  protected tickEvery(id: string) {
    const brands = tickAll(this.value().brands, id);
    if (brands !== this.value().brands)
      this.value.update((v) => ({ ...v, brands }));
  }

  protected tap(brand: Brand) {
    this.set(brand, next(this.stanceOf(brand.id)));
  }

  // A brand found by search is taken, as a new chip or in place.
  protected pick(brand: Brand) {
    if (!this.chips().some((c) => c.id === brand.id)) {
      this.added.update((added) => [...added, brand]);
      this.tellOrder();
    }
    this.set(brand, 'works_on');
    this.clear();
  }

  protected find(field: HTMLInputElement) {
    this.query.set(field.value);
    clearTimeout(this.timer);
    const q = field.value.trim();
    if (!q) {
      this.clear();
      return;
    }
    this.timer = setTimeout(() => this.search(q), DEBOUNCE_MS);
  }

  protected write(text: Text, field: HTMLInputElement) {
    const max = this.limits[text];
    const trimmed = field.value.trim();
    if (letters(trimmed) > max) field.value = cut(trimmed, max);
    const { [text]: _, ...rest } = this.value();
    const cleaned = clean(field.value, max);
    this.value.set(cleaned ? { ...rest, [text]: cleaned } : rest);
  }

  protected left(text: Text) {
    return this.limits[text] - letters(this.value()[text] ?? '');
  }

  private set(brand: Brand, stance: Stance | undefined) {
    this.value.update((v) => ({ ...v, brands: mark(v.brands, brand, stance) }));
  }

  private clear() {
    this.searches++;
    this.query.set('');
    this.results.set([]);
    this.notice.set(null);
  }

  private async search(q: string) {
    const turn = ++this.searches;
    try {
      const page = await this.catalogue.brandsControllerSearch({ q });
      if (turn !== this.searches) return;
      this.results.set(page.items);
      this.notice.set(
        page.items.length ? null : 'public.listing.brands.noMatch',
      );
    } catch {
      if (turn !== this.searches) return;
      this.results.set([]);
      this.notice.set('public.listing.brands.searchDown');
    }
  }
}
