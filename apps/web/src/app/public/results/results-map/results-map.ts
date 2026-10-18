import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import {
  afterNextRender,
  afterRenderEffect,
  Component,
  computed,
  DestroyRef,
  ElementRef,
  effect,
  InjectionToken,
  inject,
  input,
  output,
  PLATFORM_ID,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import type {
  BrandRefDto,
  GaragePinDto,
  GaragePinsDto,
  ListedGarageDto,
} from '@motor-fix/data-access';
import { TranslatePipe } from '@motor-fix/i18n';

import { MapCard } from './map-card/map-card';
import { drawPins, type MapEvents, type MapMove } from './pins-map';
import {
  closeMapLibre,
  keepOutOfTabOrder,
  type LatLng,
  openMapLibre,
  styleFor,
} from '../../map-libre/map-libre';

// The small card keeps 8 px below the map's top and 14 px above its pin;
// results-map.css keeps the same 8 px at its sides.
const EDGE = 8;
const GAP = 14;

export interface ResultsMapView {
  destroy(): void;
  fit(place: LatLng | undefined, answer: GaragePinsDto | undefined): void;
  show(answer: GaragePinsDto | undefined): void;
  light(id: string | undefined): void;
  spot(at: LatLng): { x: number; y: number };
  mark(place: LatLng | undefined): void;
}

// A tapped pin whose garage the list does not show, and that garage once read.
export interface PinCard {
  pin: GaragePinDto;
  garage?: ListedGarageDto;
}

type OpenResultsMap = (
  host: HTMLElement,
  on: MapEvents,
  here: HTMLElement,
) => Promise<ResultsMapView>;

// Opens the results map in the browser; the component never sees MapLibre,
// which is fetched only once the page has rendered.
export const RESULTS_MAP = new InjectionToken<OpenResultsMap>('RESULTS_MAP', {
  factory: () => {
    const document = inject(DOCUMENT);
    return async (host, on, here) => {
      const map = await openMapLibre(host, styleFor(document));
      const { Marker } = await import('maplibre-gl');
      const stop = keepOutOfTabOrder(host);
      const pins = drawPins(map, host, on, new Marker({ element: here }));
      return {
        ...pins,
        destroy: () => {
          stop();
          closeMapLibre(map);
        },
      };
    };
  },
});

// The garages of the search on a map beside the list. The map is not the
// accessible path: the list carries every garage, so the canvas stays out
// of the keyboard order and away from assistive technology.
@Component({
  imports: [MapCard, TranslatePipe],
  selector: 'mf-results-map',
  styleUrl: './results-map.css',
  templateUrl: './results-map.html',
})
export class ResultsMap {
  readonly pins = input<GaragePinsDto | undefined>();
  readonly place = input<LatLng | undefined>();
  readonly brand = input.required<string>();
  readonly loading = input(false);
  // The garage whose pin is lit, and the small card of a tapped pin.
  readonly lit = input<string | undefined>();
  readonly card = input<PinCard | undefined>();
  readonly cardBrand = input<BrandRefDto | undefined>();
  // The box the driver moved the map to, once it has settled.
  readonly moved = output<string>();
  // The garage of a tapped pin, or none for a tap away from every pin.
  readonly picked = output<string | undefined>();
  protected readonly tooWide = signal(false);
  // The style failed or never loaded; the grey map stays and says so.
  protected readonly failed = signal(false);
  protected readonly hasArea = computed(() =>
    this.pins()?.pins.some((pin) => pin.serviceRadiusKm !== undefined),
  );

  private readonly host = viewChild.required<ElementRef<HTMLElement>>('host');
  // The "you are here" marker, styled here and moved onto the map by MapLibre.
  private readonly here = viewChild.required<ElementRef<HTMLElement>>('here');
  protected readonly view = signal<ResultsMapView | undefined>(undefined);
  private fitWanted = false;
  // Bumped on every move of the map, so the small card follows its pin.
  private readonly shifts = signal(0);
  // The small card's own height once drawn, to keep it inside the map.
  private readonly small = viewChild<unknown, ElementRef<HTMLElement>>(
    'small',
    { read: ElementRef },
  );
  private readonly smallHeight = signal(0);
  // Where the small card stands: above its pin, pushed down rather than
  // flipped where the pin sits too near the top.
  protected readonly cardAt = computed(() => {
    const view = this.view();
    const card = this.card();
    const brand = this.cardBrand();
    if (!view || !card || !brand) return undefined;
    this.shifts();
    const { x, y } = view.spot({ lat: card.pin.lat, lng: card.pin.lng });
    const top = Math.max(EDGE, y - this.smallHeight() - GAP);
    return { brand, card, top: `${top}px`, x: `${x}px` };
  });

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
      open(
        this.host().nativeElement,
        {
          moved: (move) => this.follow(move),
          picked: (id) => this.picked.emit(id),
          shifted: () => this.shifts.update((n) => n + 1),
        },
        this.here().nativeElement,
      ).then(
        (view) => {
          if (closed) return view.destroy();
          this.view.set(view);
          if (this.fitWanted) this.fit();
        },
        () => this.failed.set(true),
      );
    });
    effect(() => this.view()?.show(this.pins()));
    effect(() => this.view()?.light(this.lit()));
    effect(() => this.view()?.mark(this.place()));
    // Measured again once the garage fills the card, which makes it taller.
    afterRenderEffect(() => {
      this.card();
      const small = this.small()?.nativeElement;
      if (small) this.smallHeight.set(small.offsetHeight);
    });
  }

  private follow(move: MapMove) {
    const tooWide = 'tooWide' in move;
    this.tooWide.set(tooWide);
    if (!tooWide) this.moved.emit(move.bbox);
  }

  // Frames the place and the pins, at once when the map is open, else as
  // soon as it opens; the search's own frame is never too wide.
  fit() {
    const view = untracked(this.view);
    this.fitWanted = !view;
    this.tooWide.set(false);
    view?.fit(untracked(this.place), untracked(this.pins));
  }
}
