import { Component, inject, type Signal } from '@angular/core';
import {
  SEARCH_MIN_RATINGS,
  SEARCH_PRICE_CEILINGS,
} from '@motor-fix/contracts/search-place';
import { formatRating, I18n, TranslatePipe } from '@motor-fix/i18n';
import { injectOverlayTask } from '@motor-fix/overlays';
import { HlmSwitch } from '@motor-fix/ui-cockpit';

import { type Filters, SWITCHES, type SwitchKey } from '../filters';

export interface FiltersPanelData {
  filters: Signal<Filters>;
  change: (patch: Partial<Filters>) => void;
}

type ChoiceKey = 'max_price' | 'min_rating';

// The filters of the results page: every control applies at once, so the
// panel holds nothing to confirm, and shows what the address bar holds. The
// two hours switches come first, then the price and rating choices, then card
// payment.
@Component({
  imports: [HlmSwitch, TranslatePipe],
  selector: 'mf-filters-panel',
  styleUrl: './filters-panel.css',
  templateUrl: './filters-panel.html',
})
export class FiltersPanel {
  private readonly task = injectOverlayTask<FiltersPanelData, never>();
  private readonly i18n = inject(I18n);
  protected readonly hours = SWITCHES.slice(0, 2);
  protected readonly card = SWITCHES[2];
  protected readonly prices = SEARCH_PRICE_CEILINGS;
  protected readonly ratings = SEARCH_MIN_RATINGS;
  protected readonly filters = this.task.data.filters;

  protected rating(value: string) {
    return formatRating(Number(value), this.i18n.language());
  }

  protected toggle(key: SwitchKey) {
    this.task.data.change({ [key]: !this.filters()[key] });
  }

  // A choice picked again clears it; another replaces it.
  protected choose<K extends ChoiceKey>(key: K, value: Filters[K]) {
    this.task.data.change({
      [key]: this.filters()[key] === value ? undefined : value,
    });
  }
}
