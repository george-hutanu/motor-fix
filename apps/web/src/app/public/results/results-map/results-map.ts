import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import {
  afterNextRender,
  Component,
  computed,
  DestroyRef,
  type ElementRef,
  effect,
  InjectionToken,
  inject,
  input,
  PLATFORM_ID,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import type { GaragePinsDto } from '@motor-fix/data-access';
import { TranslatePipe } from '@motor-fix/i18n';

import { drawPins } from './pins-map';
import {
  closeMapLibre,
  type LatLng,
  openMapLibre,
  styleFor,
} from '../../map-libre/map-libre';

export interface ResultsMapView {
  destroy(): void;
  fit(place: LatLng | undefined, answer: GaragePinsDto | undefined): void;
  show(answer: GaragePinsDto | undefined): void;
}

export type OpenResultsMap = (host: HTMLElement) => Promise<ResultsMapView>;

// Opens the results map in the browser; the component never sees MapLibre,
// which is fetched only once the page has rendered.
export const RESULTS_MAP = new InjectionToken<OpenResultsMap>('RESULTS_MAP', {
  factory: () => {
    const document = inject(DOCUMENT);
    return async (host) => {
      const map = await openMapLibre(host, styleFor(document));
      const pins = drawPins(map, host);
      return { ...pins, destroy: () => closeMapLibre(map) };
    };
  },
});

// The garages of the search on a map beside the list. The map is not the
// accessible path: the list carries every garage, so the canvas stays out
// of the keyboard order and away from assistive technology.
@Component({
  imports: [TranslatePipe],
  selector: 'mf-results-map',
  styleUrl: './results-map.css',
  templateUrl: './results-map.html',
})
export class ResultsMap {
  readonly pins = input<GaragePinsDto | undefined>();
  readonly place = input<LatLng | undefined>();
  readonly brand = input.required<string>();
  readonly loading = input(false);
  protected readonly hasArea = computed(() =>
    this.pins()?.pins.some((pin) => pin.serviceRadiusKm !== undefined),
  );

  private readonly host = viewChild.required<ElementRef<HTMLElement>>('host');
  protected readonly view = signal<ResultsMapView | undefined>(undefined);
  private fitWanted = false;

  constructor() {
    const open = inject(RESULTS_MAP);
    const browser = isPlatformBrowser(inject(PLATFORM_ID));
    let closed = false;
    inject(DestroyRef).onDestroy(() => {
      closed = true;
      untracked(this.view)?.destroy();
    });
    afterNextRender(() => {
      if (!browser) return;
      open(this.host().nativeElement).then(
        (view) => {
          if (closed) return view.destroy();
          this.view.set(view);
          if (this.fitWanted) this.fit();
        },
        // The grey map stays; saying so is the unavailable state's.
        () => undefined,
      );
    });
    effect(() => this.view()?.show(this.pins()));
  }

  // Frames the place and the pins, at once when the map is open, else as
  // soon as it opens.
  fit() {
    const view = untracked(this.view);
    this.fitWanted = !view;
    view?.fit(untracked(this.place), untracked(this.pins));
  }
}
