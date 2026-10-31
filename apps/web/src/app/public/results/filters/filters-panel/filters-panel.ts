import { Component, type Signal } from '@angular/core';
import { TranslatePipe } from '@motor-fix/i18n';
import { injectOverlayTask } from '@motor-fix/overlays';
import { HlmSwitch } from '@motor-fix/ui-cockpit';

import { FILTERS, type FilterKey, type Filters } from '../filters';

export interface FiltersPanelData {
  filters: Signal<Filters>;
  toggle: (key: FilterKey) => void;
}

// The filters of the results page: a switch applies at once, so the panel
// holds nothing to confirm, and shows what the address bar holds.
@Component({
  imports: [HlmSwitch, TranslatePipe],
  selector: 'mf-filters-panel',
  styleUrl: './filters-panel.css',
  templateUrl: './filters-panel.html',
})
export class FiltersPanel {
  private readonly task = injectOverlayTask<FiltersPanelData, never>();
  protected readonly rows = FILTERS;
  protected readonly filters = this.task.data.filters;

  protected toggle(key: FilterKey) {
    this.task.data.toggle(key);
  }
}
