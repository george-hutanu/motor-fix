import { Component, input, output } from '@angular/core';
import { SEARCH_SORTS, type SearchSort } from '@motor-fix/contracts';
import { TranslatePipe } from '@motor-fix/i18n';

let next = 0;

// The order of the list: three buttons, the current one pressed. Distanță
// needs a place, so it is off, saying why, until one is known.
@Component({
  imports: [TranslatePipe],
  selector: 'mf-sort-control',
  styleUrl: './sort-control.css',
  templateUrl: './sort-control.html',
})
export class SortControl {
  readonly sort = input.required<SearchSort>();
  readonly placeKnown = input(true);
  readonly pick = output<SearchSort>();

  protected readonly sorts = SEARCH_SORTS;
  protected readonly whyId = `mf-sort-why-${next++}`;

  protected off(sort: SearchSort) {
    return sort === 'distance' && !this.placeKnown();
  }
}
