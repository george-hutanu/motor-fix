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
import { Layout, REDUCED_MOTION } from '@motor-fix/ui-cockpit';

import { MapCard } from './map-card/map-card';
import { drawPins, type MapEvents, type MapMove } from './pins-map';
import {
  closeMapLibre,
  keepOutOfTabOrder,
  type LatLng,
  type MapStart,
  openMapLibre,
  styleFor,
} from '../../map-libre/map-libre';
import {
  boundsOf,
  fitView,
  type MapView,
  paddingOf,
  pointsOf,
} from '../../static-map/fit-view';
import { StaticMap } from '../../static-map/static-map';

// The small card keeps 8 px below the map's top and 14 px above its pin;
// results-map.css keeps the same 8 px at its sides.
const EDGE = 8;
// What a phone's fit keeps of the map between its covers: the pins' 40 px
// padding on both sides and 40 px to frame them in.
const ROOM = 120;
// The gap the sheet leaves under the static map's control on a phone, as
// --mf-space-2.
const CONTROL_GAP = 8;
const GAP = 14;
// The static map's fade into the interactive one.
const FADE_MS = 200;

export interface ResultsMapView {
  destroy(): void;
  fit(
    place: LatLng | undefined,
    answer: GaragePinsDto | undefined,
    covered?: number,
    coveredTop?: number,
  ): void;
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
  start: MapStart,
) => Promise<ResultsMapView>;

// Opens the results map in the browser at the static map's view; the
// component never sees MapLibre, which is fetched only once the driver asks
// for the interactive map.
export const RESULTS_MAP = new InjectionToken<OpenResultsMap>('RESULTS_MAP', {
  factory: () => {
    const document = inject(DOCUMENT);
    return async (host, on, here, start) => {
      // From the start: MapLibre adds its focusable canvas while the style
      // is still loading, under the grey placeholder.
      const stop = keepOutOfTabOrder(host);
      let map: Awaited<ReturnType<typeof openMapLibre>> | undefined;
      try {
        map = await openMapLibre(host, styleFor(document), undefined, start);
        const { Marker } = await import('maplibre-gl');
        const pins = drawPins(map, host, on, new Marker({ element: here }));
        const opened = map;
        return {
          ...pins,
          destroy: () => {
            stop();
            closeMapLibre(opened);
          },
        };
      } catch (error) {
        // Nothing half-open is left behind: the map, if it opened, and the
        // tab-order watcher go with the failure.
        stop();
        if (map) closeMapLibre(map);
        throw error;
      }
    };
  },
});

// The garages of the search on a map beside the list: a static image first,
// the interactive map once the driver asks for it. The map is not the
// accessible path: the list carries every garage, so the canvas stays out
// of the keyboard order and away from assistive technology.
@Component({
  imports: [MapCard, StaticMap, TranslatePipe],
  selector: 'mf-results-map',
  styleUrl: './results-map.css',
  templateUrl: './results-map.html',
})
export class ResultsMap {
  readonly pins = input<GaragePinsDto | undefined>();
  readonly place = input<LatLng | undefined>();
  readonly brand = input.required<string>();
  readonly loading = input(false);
  // Off where no pins can be shown or the search failed or was refused: the colours have nothing to explain.
  readonly legend = input(true);
  // The garage whose pin is lit, and the small card of a tapped pin.
  readonly lit = input<string | undefined>();
  readonly card = input<PinCard | undefined>();
  readonly cardBrand = input<BrandRefDto | undefined>();
  // The box the driver moved the map to, once it has settled.
  readonly moved = output<string>();
  // The garage of a tapped pin, or none for a tap away from every pin.
  readonly picked = output<string | undefined>();
  protected readonly tooWide = signal(false);
  // The style failed or never loaded; the grey map stays and says so, and
  // on a phone the page's summary says it instead.
  private readonly failure = signal(false);
  private readonly layout = inject(Layout);
  private readonly element = inject<ElementRef<HTMLElement>>(ElementRef);
  readonly failed = this.failure.asReadonly();
  protected readonly phone = computed(() => this.layout.current() === 'phone');
  protected readonly hasArea = computed(() =>
    this.pins()?.pins.some((pin) => pin.serviceRadiusKm !== undefined),
  );

  private readonly host = viewChild.required<ElementRef<HTMLElement>>('host');
  // The "you are here" marker, styled here and moved onto the map by MapLibre.
  private readonly here = viewChild.required<ElementRef<HTMLElement>>('here');
  protected readonly view = signal<ResultsMapView | undefined>(undefined);
  private fitWanted = false;
  // The static map until the driver asks for the interactive one, which then
  // loads; once it has, the static map fades and goes.
  protected readonly stage = signal<'static' | 'loading' | 'leaving' | 'gone'>(
    'static',
  );
  // The box and its covered bands as last measured; none on the server.
  private readonly measured = signal<
    { w: number; h: number; bottom: number; top: number } | undefined
  >(undefined);
  // On a phone, the sheet rests over the static map's control, short of
  // the 8 px gap under it: the control hides (static-map.css).
  protected readonly cramped = signal(false);
  // How far up the static map's corner sits from a tablet up: above the
  // legend. On a phone its control and credit take the interactive map's
  // places (static-map.css), off the sheet.
  protected readonly covered = computed(() =>
    this.phone() ? 0 : (this.measured()?.bottom ?? 0),
  );
  // The view the static image shows, which the interactive map opens at.
  protected readonly still = computed<MapView | undefined>(() => {
    const at = this.measured();
    if (!at) return undefined;
    return fitView(
      boundsOf(pointsOf(this.place(), this.pins())),
      at,
      paddingOf(at.bottom, at.top),
    );
  });
  private readonly reduced = inject(REDUCED_MOTION);
  private readonly open = inject(RESULTS_MAP);
  private readonly browser = isPlatformBrowser(inject(PLATFORM_ID));
  private closed = false;
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
    const destroyRef = inject(DestroyRef);
    destroyRef.onDestroy(() => {
      this.closed = true;
      untracked(this.view)?.destroy();
    });
    afterNextRender(() => {
      if (!this.browser) return;
      this.measure();
      if (typeof ResizeObserver === 'undefined') return;
      const resized = new ResizeObserver(() => {
        if (!untracked(this.view)) this.measure();
      });
      resized.observe(this.host().nativeElement);
      destroyRef.onDestroy(() => resized.disconnect());
    });
    // A phone's sheet slides in, and between its rests, after the first
    // measure: once it stops, the static map's view and its corner follow.
    afterNextRender(() => {
      const around = this.element.nativeElement.parentElement;
      if (!this.browser || !around) return;
      const again = () => {
        if (!untracked(this.view) && untracked(this.phone)) this.measure();
      };
      const settled = (event: Event) => {
        if ((event.target as Element | null)?.tagName === 'MF-RESULTS-SHEET')
          again();
      };
      around.addEventListener('animationend', settled);
      around.addEventListener('transitionend', settled);
      // Under reduced motion the sheet moves with no transition to end: its
      // own attributes changing (its rest, its header's height) say it has.
      const moved = new MutationObserver((changes) => {
        if (
          changes.some(({ target }) => target.nodeName === 'MF-RESULTS-SHEET')
        )
          again();
      });
      moved.observe(around, {
        attributeFilter: ['class', 'data-position', 'style'],
        subtree: true,
      });
      destroyRef.onDestroy(() => {
        around.removeEventListener('animationend', settled);
        around.removeEventListener('transitionend', settled);
        moved.disconnect();
      });
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

  // The driver asked for the interactive map: it opens at the static view,
  // and a second ask while it loads does nothing.
  protected activate() {
    if (!this.browser || untracked(this.stage) !== 'static') return;
    this.stage.set('loading');
    const still = untracked(this.still) ?? this.measure();
    this.open(
      this.host().nativeElement,
      {
        moved: (move) => this.follow(move),
        picked: (id) => this.picked.emit(id),
        shifted: () => this.shifts.update((n) => n + 1),
      },
      this.here().nativeElement,
      { center: [still.center.lng, still.center.lat], zoom: still.zoom },
    ).then(
      (view) => {
        if (this.closed) return view.destroy();
        this.view.set(view);
        if (this.fitWanted) this.fit();
        this.stage.set('leaving');
        setTimeout(
          () => this.stage.set('gone'),
          untracked(this.reduced) ? 0 : FADE_MS,
        );
      },
      () => this.failure.set(true),
    );
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
    if (!view) {
      this.measure();
      return;
    }
    const place = untracked(this.place);
    const pins = untracked(this.pins);
    if (untracked(this.phone)) {
      const { bottom, top } = this.phoneCovers();
      view.fit(place, pins, bottom, top);
    } else view.fit(place, pins, this.legendCover());
  }

  // Measures the box and what covers it, which frames the static view.
  private measure(): MapView {
    const host = this.host().nativeElement;
    const { bottom, top, cramped } = untracked(this.phone)
      ? this.phoneCovers()
      : { bottom: this.legendCover(), cramped: false, top: 0 };
    this.cramped.set(cramped);
    this.measured.set({
      bottom,
      h: host.clientHeight,
      top,
      w: host.clientWidth,
    });
    return untracked(this.still) as MapView;
  }

  // How far up the map's bottom edge the legend reaches, in pixels.
  private legendCover() {
    const map = this.host().nativeElement.parentElement;
    const key = map?.querySelector('.legend');
    if (!map || !key) return 0;
    return Math.max(
      0,
      map.getBoundingClientRect().bottom - key.getBoundingClientRect().top,
    );
  }

  // On a phone the legend and the static map's control sit at the map's
  // top and the results sheet, the map's sibling, over its lower part; the
  // pins are framed between them.
  private phoneCovers() {
    const map = this.host().nativeElement.parentElement;
    const sheet = this.element.nativeElement.parentElement?.querySelector(
      ':scope > mf-results-sheet',
    );
    if (!map) return { bottom: 0, cramped: false, top: 0 };
    const box = map.getBoundingClientRect();
    const [legend, control] = [
      map.querySelector('.legend'),
      map.querySelector('mf-static-map button'),
    ].map((above) =>
      above ? above.getBoundingClientRect().bottom - box.top : 0,
    );
    const top = Math.max(0, legend, control);
    const sheetTop = sheet?.getBoundingClientRect().top;
    const under =
      sheetTop === undefined ? 0 : Math.max(0, box.bottom - sheetTop);
    const cramped =
      sheetTop !== undefined &&
      control > 0 &&
      sheetTop - box.top < control + CONTROL_GAP;
    const bottom = Math.max(
      0,
      Math.min(under, box.bottom - box.top - top - ROOM),
    );
    return { bottom, cramped, top };
  }
}
