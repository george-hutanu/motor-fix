import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  Injector,
  inject,
  input,
  output,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import type { CarDto, SavedGarageItemDto } from '@motor-fix/data-access';
import { I18n, TranslatePipe } from '@motor-fix/i18n';
import { HlmButton } from '@motor-fix/ui-cockpit';

import { EmptyState } from '../../empty-state/empty-state';
import { SavedGarageRow } from '../saved-garage-row/saved-garage-row';
import { SavedGaragesList } from '../saved-garages-list';

// "Service-uri salvate": the driver's saved garages, newest first. With a
// limit it is Panou's section, with Vezi toate to the view; the view adds its
// further pages through `more`, and its subtitle counts those that work on
// the driver's cars. Caută altele opens the results for the first car's brand.
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [EmptyState, HlmButton, RouterLink, SavedGarageRow, TranslatePipe],
  selector: 'mf-saved-garages-panel',
  styleUrl: './saved-garages-panel.css',
  templateUrl: './saved-garages-panel.html',
})
export class SavedGaragesPanel {
  readonly limit = input<number | undefined>(undefined);
  readonly more = input<readonly SavedGarageItemDto[]>([]);
  // A further page could not be read: said under the rows, with Reîncearcă.
  readonly moreFailed = input(false);
  readonly retried = output();
  readonly subtitle = input(false);
  // Undefined while the cars are not known: no row asks for a car then.
  readonly cars = input<readonly CarDto[] | undefined>(undefined);
  protected readonly list = inject(SavedGaragesList);
  private readonly i18n = inject(I18n);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);
  protected readonly language = this.i18n.language;

  protected readonly rows = computed(() => {
    const first = this.list.rows();
    if (!first) return undefined;
    const seen = new Set(first.map((row) => row.garageId));
    const rest = this.list
      .visible(this.more())
      .filter((row) => !seen.has(row.garageId));
    const rows = rest.length ? [...first, ...rest] : first;
    const limit = this.limit();
    return limit === undefined ? rows : rows.slice(0, limit);
  });
  protected readonly hasCar = computed(() => this.cars()?.length !== 0);
  protected readonly findMore = computed(() => {
    const brand = this.cars()?.[0]?.brandId;
    return {
      link: brand ? ['/', this.language(), 'garages'] : ['/', this.language()],
      query: brand ? { brand } : undefined,
    };
  });
  protected readonly said = computed(() => {
    const count = this.list.workingCount();
    return count === undefined
      ? undefined
      : this.i18n.t('driver.saved.subtitle', { count });
  });
  protected readonly seeAll = computed(() => {
    const limit = this.limit();
    const total = this.list.total();
    return limit !== undefined && total !== undefined && total > limit;
  });

  constructor() {
    // Its own texts, and ST-290's for the removal's bar and undo.
    void this.i18n.enter('driver');
    void this.i18n.enter('public');
    this.list.open();
  }

  // The focus goes to the row that took its place, else the one before it,
  // else Caută altele.
  protected remove(row: SavedGarageItemDto, index: number) {
    void this.list.remove(row.garageId, row);
    afterNextRender(
      () => {
        const element = this.host.nativeElement;
        const links = element.querySelectorAll<HTMLElement>('a[data-profile]');
        const next =
          links[index] ??
          links[index - 1] ??
          element.querySelector<HTMLElement>('a[data-find-more]');
        next?.focus();
      },
      { injector: this.injector },
    );
  }
}
