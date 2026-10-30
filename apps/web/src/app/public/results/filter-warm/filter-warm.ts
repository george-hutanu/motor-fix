import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import { Injectable, inject, PLATFORM_ID } from '@angular/core';
import {
  type GarageSearchControllerForBrand$Params,
  SearchService,
} from '@motor-fix/data-access';

import { measure } from '../../../telemetry/browser/measure/measure';
import { prefetchAllowed } from '../../profile-prefetch/prefetch-allowed';

// How long a warmed answer counts as a hit after it landed.
export const LIFE_MS = 60_000;

type Query = Omit<GarageSearchControllerForBrand$Params, 'cursor' | 'ids'>;
type Outcome = 'fetched' | 'hit' | 'expired' | 'skipped';

// The open-now answer of a search read ahead, once the unfiltered list has
// landed, so the HTTP cache holds it for the likeliest toggle. Never logged,
// and what it reports names no brand or place.
@Injectable({ providedIn: 'root' })
export class FilterWarm {
  private readonly search = inject(SearchService);
  private readonly document = inject(DOCUMENT);
  private readonly browser = isPlatformBrowser(inject(PLATFORM_ID));
  // Every search warmed, so none is read twice; a landed one holds its time.
  private readonly warmed = new Set<string>();
  private readonly landed = new Map<string, number>();
  private skipped = false;

  warm(query: Query): void {
    if (!this.browser) return;
    if (!prefetchAllowed(this.document)) {
      if (!this.skipped) this.report('skipped');
      this.skipped = true;
      return;
    }
    const key = JSON.stringify(query);
    if (this.warmed.has(key)) return;
    this.warmed.add(key);
    const { sort: _, ...pins } = query;
    const started = Date.now();
    Promise.all([
      this.search.garageSearchControllerForBrand({ ...query, open_now: '1' }),
      this.search.garageSearchControllerPins({ ...pins, open_now: '1' }),
    ]).then(
      () => {
        this.landed.set(key, Date.now());
        this.report('fetched', Date.now() - started);
      },
      () => undefined,
    );
  }

  // The toggle to open now alone: a hit on a young warm, else an expiry.
  // Counted once, then forgotten.
  judge(query: Query): void {
    const key = JSON.stringify(query);
    const at = this.landed.get(key);
    if (at === undefined) return;
    this.landed.delete(key);
    this.report(Date.now() - at < LIFE_MS ? 'hit' : 'expired');
  }

  private report(outcome: Outcome, duration = 0): void {
    measure('prefetch', { duration }, { outcome, path: 'filter' });
  }
}
