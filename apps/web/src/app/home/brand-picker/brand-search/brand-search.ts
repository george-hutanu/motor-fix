import {
  afterNextRender,
  Component,
  computed,
  type ElementRef,
  Injector,
  inject,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { type BrandDto, BrandsService } from '@motor-fix/data-access';
import { TranslatePipe } from '@motor-fix/i18n';
import { HlmInput, HlmLabel } from '@motor-fix/ui-cockpit';

import { matches } from './brand-match';

@Component({
  imports: [HlmInput, HlmLabel, TranslatePipe],
  selector: 'mf-brand-search',
  styleUrl: './brand-search.css',
  templateUrl: './brand-search.html',
})
export class BrandSearch {
  private readonly api = inject(BrandsService);
  private readonly injector = inject(Injector);
  private readonly field =
    viewChild.required<ElementRef<HTMLInputElement>>('field');

  readonly reached = output<void>();
  readonly chosen = output<BrandDto>();

  protected readonly state = signal<'idle' | 'loading' | 'loaded' | 'failed'>(
    'idle',
  );
  private readonly brands = signal<BrandDto[]>([]);
  protected readonly text = signal('');
  protected readonly open = signal(false);
  protected readonly active = signal(-1);
  private told = false;

  protected readonly typed = computed(() => this.text().trim() !== '');
  protected readonly found = computed(() =>
    this.state() === 'loaded' ? matches(this.brands(), this.text()) : [],
  );
  protected readonly listed = computed(
    () => this.open() && this.found().length > 0,
  );
  protected readonly none = computed(
    () => this.state() === 'loaded' && this.typed() && !this.found().length,
  );

  // The list is read only once someone reaches for the field, never on the
  // server, and all of it, so a brand on a later page is found too.
  protected reach() {
    if (!this.told) {
      this.told = true;
      this.reached.emit();
    }
    if (this.state() === 'idle') void this.load();
  }

  protected retry() {
    if (this.state() !== 'failed') return;
    void this.load().then(() => {
      if (this.state() !== 'loaded') return;
      afterNextRender(() => this.field().nativeElement.focus(), {
        injector: this.injector,
      });
    });
  }

  protected write(value: string) {
    this.text.set(value);
    this.open.set(true);
    this.active.set(-1);
  }

  protected key(event: KeyboardEvent) {
    this.reach();
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      this.move(event, event.key === 'ArrowDown' ? 1 : -1);
    } else if (event.key === 'Enter') {
      const brand = this.listed() ? this.found()[this.active()] : undefined;
      if (!brand) return;
      event.preventDefault();
      this.choose(brand);
    } else if (event.key === 'Escape') {
      this.close();
    }
  }

  // The active suggestion wraps at both ends; none is active until an arrow.
  private move(event: KeyboardEvent, step: 1 | -1) {
    const count = this.found().length;
    if (!count) return;
    event.preventDefault();
    this.open.set(true);
    const at = this.active() < 0 && step < 0 ? 0 : this.active();
    this.active.set((at + step + count) % count);
  }

  protected choose(brand: BrandDto) {
    this.chosen.emit(brand);
    this.text.set('');
    this.close();
    this.field().nativeElement.focus();
  }

  protected close() {
    this.open.set(false);
    this.active.set(-1);
  }

  protected option(index: number) {
    return `mf-brand-search-option-${index}`;
  }

  private async load() {
    this.state.set('loading');
    const all: BrandDto[] = [];
    try {
      let cursor: string | undefined;
      do {
        const page = await this.api.brandsControllerSearch({ cursor });
        all.push(...page.items);
        cursor = page.nextCursor ?? undefined;
      } while (cursor);
    } catch {
      this.state.set('failed');
      return;
    }
    this.brands.set(all);
    this.state.set('loaded');
  }
}
