import { isPlatformServer } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  inject,
  model,
  PLATFORM_ID,
  signal,
} from '@angular/core';
import { type BrandDto, BrandsService } from '@motor-fix/data-access';
import { I18n, TranslatePipe } from '@motor-fix/i18n';
import { HlmInput, HlmLabel, Lamp } from '@motor-fix/ui-cockpit';

import {
  type BrandsSection,
  clean,
  counts,
  cut,
  letters,
  mark,
  NOTE_MAX,
  next,
  PHRASE_MAX,
  type Stance,
} from '../brands-section';

const POPULAR = 12;
// The search waits for the owner to stop typing.
const DEBOUNCE_MS = 250;

type Brand = Pick<BrandDto, 'id' | 'name'>;
type Text = 'brandNote' | 'refusalPhrase';

// Step 2 of listing a garage: each brand taken, refused or left off, plus a
// short note and a refusal phrase. It holds the draft's section and saves
// nothing.
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [HlmInput, HlmLabel, Lamp, TranslatePipe],
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
    inject(DestroyRef).onDestroy(() => clearTimeout(this.timer));
    // The chips come with the client: a server render would drop the answer.
    if (isPlatformServer(inject(PLATFORM_ID))) return;
    this.catalogue.brandsControllerSearch({}).then(
      (page) => this.popular.set(page.items.slice(0, POPULAR)),
      () => this.notice.set('public.listing.brands.searchDown'),
    );
  }

  protected input(event: Event) {
    return event.target as HTMLInputElement;
  }

  protected stanceOf(id: string): Stance | undefined {
    return this.value().brands.find((b) => b.brandId === id)?.stance;
  }

  protected tap(brand: Brand) {
    this.set(brand, next(this.stanceOf(brand.id)));
  }

  // A brand found by search is taken, as a new chip or in place.
  protected pick(brand: Brand) {
    if (!this.chips().some((c) => c.id === brand.id))
      this.added.update((added) => [...added, brand]);
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
