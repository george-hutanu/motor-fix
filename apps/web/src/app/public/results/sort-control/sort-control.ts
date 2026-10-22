import { Component, input, output } from '@angular/core';
import type { SearchSort } from '@motor-fix/contracts/search-place';
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

  protected readonly sorts = [
    { label: 'public.results.sort.rating', sort: 'rating' },
    { label: 'public.results.sort.distance', sort: 'distance' },
    { label: 'public.results.sort.price', sort: 'price' },
  ] as const;
  protected readonly whyId = `mf-sort-why-${next++}`;

  protected off(sort: SearchSort) {
    return sort === 'distance' && !this.placeKnown();
  }
}
