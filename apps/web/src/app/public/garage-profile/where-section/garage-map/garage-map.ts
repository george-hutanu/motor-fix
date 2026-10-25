import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import {
  afterNextRender,
  Component,
  computed,
  DestroyRef,
  type ElementRef,
  InjectionToken,
  inject,
  input,
  output,
  PLATFORM_ID,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import type { LatLng } from '@motor-fix/contracts/map-view';
import { REDUCED_MOTION } from '@motor-fix/ui-cockpit';

import {
  closeMapLibre,
  keepOutOfTabOrder,
  type MapStart,
  openMapLibre,
  styleFor,
} from '../../../map-libre/map-libre';
import {
  type Box,
  boundsOf,
  fitView,
  type MapView,
  paddingOf,
} from '../../../static-map/fit-view';
import { StaticMap } from '../../../static-map/static-map';

// The static map's fade into the interactive one.
const FADE_MS = 200;

type OpenGarageMap = (
  host: HTMLElement,
  pin: HTMLElement,
  start: MapStart,
) => Promise<{ destroy(): void }>;

// Opens the garage's map in the browser at the static map's view, with one
// marker at the garage; MapLibre is fetched only once the driver asks.
export const GARAGE_MAP = new InjectionToken<OpenGarageMap>('GARAGE_MAP', {
  factory: () => {
    const document = inject(DOCUMENT);
    return async (host, pin, start) => {
      const stop = keepOutOfTabOrder(host);
      let map: Awaited<ReturnType<typeof openMapLibre>> | undefined;
      try {
        map = await openMapLibre(host, styleFor(document), undefined, start);
        const { Marker } = await import('maplibre-gl');
        new Marker({ element: pin }).setLngLat(start.center).addTo(map);
        const opened = map;
        return {
          destroy: () => {
            stop();
            closeMapLibre(opened);
          },
        };
      } catch (error) {
        stop();
        if (map) closeMapLibre(map);
        throw error;
      }
    };
  },
});

// One garage on a strip of map: the static image first, the interactive map
// in the same box once the driver asks. It says it is gone when neither can
// show, and its host drops it; the address is the accessible place.
@Component({
  imports: [StaticMap],
  selector: 'mf-garage-map',
  styleUrl: './garage-map.css',
  templateUrl: './garage-map.html',
})
export class GarageMap {
  readonly point = input.required<LatLng>();
  readonly gone = output<void>();

  private readonly host = viewChild.required<ElementRef<HTMLElement>>('host');
  private readonly pin = viewChild.required<ElementRef<HTMLElement>>('pin');
  private readonly box = signal<Box | undefined>(undefined);
  protected readonly stage = signal<'static' | 'opening' | 'leaving' | 'open'>(
    'static',
  );
  // The view the static image shows, which the interactive map opens at.
  protected readonly still = computed<MapView | undefined>(() => {
    const box = this.box();
    return box && fitView(boundsOf([this.point()]), box, paddingOf());
  });
  private readonly reduced = inject(REDUCED_MOTION);
  private readonly open = inject(GARAGE_MAP);
  private readonly browser = isPlatformBrowser(inject(PLATFORM_ID));
  private map: { destroy(): void } | undefined;
  private closed = false;

  constructor() {
    const destroyRef = inject(DestroyRef);
    destroyRef.onDestroy(() => {
      this.closed = true;
      this.map?.destroy();
    });
    afterNextRender(() => {
      if (!this.browser) return;
      const host = this.host().nativeElement;
      const measure = () => {
        const w = host.clientWidth;
        const h = host.clientHeight;
        const now = untracked(this.box);
        if (w > 0 && h > 0 && (now?.w !== w || now?.h !== h))
          this.box.set({ h, w });
      };
      measure();
      if (typeof ResizeObserver === 'undefined') return;
      const resized = new ResizeObserver(() => {
        if (untracked(this.stage) === 'static') measure();
      });
      resized.observe(host);
      destroyRef.onDestroy(() => resized.disconnect());
    });
  }

  // The driver asked for the interactive map: it opens at the static view,
  // and a second ask while it loads does nothing.
  protected activate() {
    const still = untracked(this.still);
    if (!this.browser || !still || untracked(this.stage) !== 'static') return;
    this.stage.set('opening');
    this.open(this.host().nativeElement, this.pin().nativeElement, {
      center: [still.center.lng, still.center.lat],
      zoom: still.zoom,
    }).then(
      (map) => {
        if (this.closed) return map.destroy();
        this.map = map;
        this.stage.set('leaving');
        setTimeout(
          () => this.stage.set('open'),
          untracked(this.reduced) ? 0 : FADE_MS,
        );
      },
      () => {
        if (!this.closed) this.gone.emit();
      },
    );
  }
}
