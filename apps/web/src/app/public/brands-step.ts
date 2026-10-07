import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  inject,
  model,
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
} from './brands-section';

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
  styles: `
    :host { display: grid; gap: var(--mf-space-3); margin-top: var(--mf-space-3); min-width: 0; }
    p { margin: 0; overflow-wrap: anywhere; }
    .hint, .left { color: var(--mf-text-secondary); }
    .left { font-size: var(--mf-size-small); }
    input { width: 100%; min-height: var(--mf-tap); box-sizing: border-box; }
    ul { display: flex; flex-wrap: wrap; gap: var(--mf-space-2); margin: 0; padding: 0; list-style: none; }
    ul button {
      display: inline-flex; align-items: center; gap: var(--mf-space-2); max-width: 100%; min-height: var(--mf-tap);
      padding: 0 var(--mf-space-3); border: 1px solid var(--mf-line); border-radius: var(--mf-radius-control);
      background: var(--mf-bg); color: var(--mf-text); font: inherit; text-align: start;
      overflow-wrap: anywhere; cursor: pointer;
    }
    ul button[aria-pressed='true'] { border-color: var(--mf-text-secondary); font-weight: 600; }
    ul button:focus-visible { outline: 2px solid var(--mf-focus); outline-offset: 2px; }
    .results button { border-style: dashed; }
    mf-lamp { font-size: var(--mf-size-small); }
    .field { display: grid; gap: var(--mf-space-1); }
  `,
  template: `
    <p class="hint">{{ 'public.listing.brands.hint' | t }}</p>
    <label hlmLabel class="field">
      {{ 'public.listing.brands.search' | t }}
      <input hlmInput type="search" autocomplete="off" [value]="query()" (input)="find(input($event))" />
    </label>
    @if (notice(); as key) {
      <p class="notice" role="status">{{ key | t }}</p>
    }
    @if (results().length) {
      <ul class="results" [attr.aria-label]="'public.listing.brands.results' | t">
        @for (brand of results(); track brand.id) {
          <li><button type="button" (click)="pick(brand)">{{ brand.name }}</button></li>
        }
      </ul>
    }
    <ul class="chips" [attr.aria-label]="'public.listing.brands.chips' | t">
      @for (brand of chips(); track brand.id) {
        @let stance = stanceOf(brand.id);
        <li>
          <button type="button" [attr.aria-pressed]="!!stance" (click)="tap(brand)">
            {{ brand.name }}
            @if (stance) {
              <mf-lamp
                [state]="stance === 'works_on' ? 'green' : 'red'"
                [label]="(stance === 'works_on' ? 'public.listing.brands.on' : 'public.listing.brands.off') | t"
              />
            }
          </button>
        </li>
      }
    </ul>
    <p aria-live="polite">{{ counter() }}</p>
    <label hlmLabel class="field">
      {{ 'public.listing.brands.note' | t }}
      <input hlmInput name="brandNote" autocomplete="off" [value]="value().brandNote ?? ''" (input)="write(note, input($event))" />
    </label>
    <p class="left">{{ 'public.listing.brands.left' | t: { count: left(note) } }}</p>
    <label hlmLabel class="field">
      {{ 'public.listing.brands.phrase' | t }}
      <input hlmInput name="refusalPhrase" autocomplete="off" [value]="value().refusalPhrase ?? ''" (input)="write(phrase, input($event))" />
    </label>
    <p class="left">{{ 'public.listing.brands.left' | t: { count: left(phrase) } }}</p>
  `,
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

  // A brand found by search is taken; one already marked keeps its stance.
  protected pick(brand: Brand) {
    if (!this.chips().some((c) => c.id === brand.id))
      this.added.update((added) => [...added, brand]);
    if (!this.stanceOf(brand.id)) this.set(brand, 'works_on');
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
    if (letters(field.value) > max) field.value = cut(field.value, max);
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
