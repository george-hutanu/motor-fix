import { Injectable } from '@angular/core';
import type {
  GarageSearchControllerForBrand$Params,
  GarageSearchPageDto,
} from '@motor-fix/data-access';

export type SearchKey = Pick<
  GarageSearchControllerForBrand$Params,
  'bbox' | 'brand' | 'brandId' | 'near' | 'radius'
>;

// What Results showed when the driver left it: its loaded pages and cursor,
// where the list was scrolled to (in the phone's sheet, or the page), and
// whether the search was logged.
export interface KeptResults {
  inSheet: boolean;
  logged: string | undefined;
  page: GarageSearchPageDto;
  scrollY: number;
}

const keyOf = ({ bbox, brand, brandId, near, radius }: SearchKey) =>
  JSON.stringify([
    brand ?? null,
    brandId ?? null,
    near ?? '',
    radius ?? '',
    bbox ?? '',
  ]);

// The last search Results showed, for the way back from a garage's profile.
// One search only, in the tab's memory: a reload or a new tab starts afresh.
@Injectable({ providedIn: 'root' })
export class ResultsMemory {
  private kept:
    | { entry: KeptResults; key: string; search: SearchKey }
    | undefined;

  keep(search: SearchKey, entry: KeptResults) {
    this.kept = { entry, key: keyOf(search), search };
  }

  // The box of the kept search, when the bar names that search otherwise.
  boxOf(search: SearchKey): string | undefined {
    const kept = this.kept;
    if (!kept?.search.bbox) return undefined;
    return keyOf({ ...search, bbox: kept.search.bbox }) === kept.key
      ? kept.search.bbox
      : undefined;
  }

  // The kept search's results, once, and only for that same search.
  take(search: SearchKey): KeptResults | undefined {
    const kept = this.kept;
    if (!kept || kept.key !== keyOf(search)) return undefined;
    this.kept = undefined;
    return kept.entry;
  }
}
