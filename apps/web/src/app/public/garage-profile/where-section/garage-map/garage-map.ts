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
import { type LatLng, STATIC_MAP_ZOOM } from '@motor-fix/contracts/map-view';
import type { GaragePinsDto } from '@motor-fix/data-access';
import { REDUCED_MOTION } from '@motor-fix/ui-cockpit';

import {
  circleBounds,
  closeMapLibre,
  keepOutOfTabOrder,
  type MapStart,
  openMapLibre,
  ring,
  styleFor,
} from '../../../map-libre/map-libre';
import {
  type Box,
  boundsOf,
  fitView,
  type MapView,
  paddingOf,
} from '../../../static-map/fit-view';
import { overlayOf } from '../../../static-map/overlay';
import { StaticMap } from '../../../static-map/static-map';

// The static map's fade into the interactive one.
const FADE_MS = 200;

type OpenGarageMap = (
  host: HTMLElement,
  pin: HTMLElement,
  at: LatLng,
  start: MapStart,
  km?: number,
) => Promise<{ destroy(): void }>;

// Opens the garage's map in the browser at the static map's view, with one
// marker at the garage's own point, or with `km` the area round it as the
// Results map rings one, in the text colour; MapLibre is fetched only once
// the driver asks.
export const GARAGE_MAP = new InjectionToken<OpenGarageMap>('GARAGE_MAP', {
  factory: () => {
    const document = inject(DOCUMENT);
    return async (host, pin, at, start, km) => {
      const stop = keepOutOfTabOrder(host);
      let map: Awaited<ReturnType<typeof openMapLibre>> | undefined;
      try {
        map = await openMapLibre(host, styleFor(document), undefined, start);
        if (km === undefined) {
          const { Marker } = await import('maplibre-gl');
          new Marker({ element: pin }).setLngLat([at.lng, at.lat]).addTo(map);
        } else {
          const ink = getComputedStyle(host)
            .getPropertyValue('--mf-text')
            .trim();
          map.addSource('area', {
            data: {
              geometry: { coordinates: [ring(at, km)], type: 'Polygon' },
              properties: {},
              type: 'Feature',
            },
            type: 'geojson',
          });
          map.addLayer({
            id: 'areas-fill',
            paint: { 'fill-color': ink, 'fill-opacity': 0.12 },
            source: 'area',
            type: 'fill',
          });
          map.addLayer({
            id: 'areas-line',
            paint: { 'line-color': ink, 'line-width': 1.5 },
            source: 'area',
            type: 'line',
          });
        }
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
// in the same box once the driver asks. With `km` the point is a mobile
// mechanic's centre and the map shows its area, a plain circle, instead of a
// marker. It says it is gone when neither can show, and its host drops it;
// the address or the area line is the accessible place.
@Component({
  imports: [StaticMap],
  selector: 'mf-garage-map',
  styleUrl: './garage-map.css',
  templateUrl: './garage-map.html',
})
export class GarageMap {
  readonly point = input.required<LatLng>();
  // A radius that is not a positive number draws the point alone.
  readonly km = input(undefined, {
    transform: (km: number | undefined) =>
      km !== undefined && Number.isFinite(km) && km > 0 ? km : undefined,
  });
  readonly gone = output<void>();

  private readonly host = viewChild.required<ElementRef<HTMLElement>>('host');
  private readonly pin = viewChild.required<ElementRef<HTMLElement>>('pin');
  private readonly box = signal<Box | undefined>(undefined);
  protected readonly stage = signal<'static' | 'opening' | 'leaving' | 'open'>(
    'static',
  );
  // The area as the static map's overlay draws a mobile mechanic's circle.
  protected readonly area = computed(() => {
    const km = this.km();
    return km === undefined ? undefined : areaOf(this.point(), km);
  });
  // The view the static image shows, which the interactive map opens at. The
  // snapped centre can move a fitted circle up to a sixteenth of the image
  // off its middle, so a zoom lower is taken until all of it is in the box.
  protected readonly still = computed<MapView | undefined>(() => {
    const box = this.box();
    if (!box) return undefined;
    const km = this.km();
    if (km === undefined)
      return fitView(boundsOf([this.point()]), box, paddingOf());
    const area = areaOf(this.point(), km);
    const bounds = boundsOf(
      circleBounds(this.point(), km).map(([lng, lat]) => ({ lat, lng })),
    );
    let view = fitView(bounds, box, paddingOf());
    while (view.zoom > STATIC_MAP_ZOOM.min && !inside(area, view, box))
      view = fitView(bounds, box, paddingOf(), view.zoom - 1);
    return view;
  });
  private readonly reduced = inject(REDUCED_MOTION);
  private readonly open = inject(GARAGE_MAP);
  private readonly browser = isPlatformBrowser(inject(PLATFORM_ID));
  private map: { destroy(): void } | undefined;
  private closed = false;
  // Said once: the host drops the box on the first word.
  private left = false;

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
  protected async activate() {
    const still = untracked(this.still);
    if (!this.browser || !still || this.left) return;
    if (untracked(this.stage) !== 'static') return;
    this.stage.set('opening');
    let map: { destroy(): void };
    try {
      map = await this.open(
        this.host().nativeElement,
        this.pin().nativeElement,
        this.point(),
        { center: [still.center.lng, still.center.lat], zoom: still.zoom },
        this.km(),
      );
    } catch {
      return this.leave();
    }
    if (this.closed) return map.destroy();
    this.map = map;
    this.stage.set('leaving');
    setTimeout(
      () => this.stage.set('open'),
      untracked(this.reduced) ? 0 : FADE_MS,
    );
  }

  // The image failed. Once the interactive map is on its way it is that
  // map's success or failure that counts.
  protected broken() {
    if (untracked(this.stage) === 'static') this.leave();
  }

  private leave() {
    if (this.closed || this.left) return;
    this.left = true;
    this.gone.emit();
  }
}

function areaOf(
  { lat, lng }: { lat: number; lng: number },
  serviceRadiusKm: number,
): GaragePinsDto {
  const pin = { id: 'area', lat, lng, matches: true, rateLei: null };
  return {
    pins: [{ ...pin, serviceRadiusKm, stance: 'unstated' }],
    total: 1,
  };
}

// Inside the box less the padding the view was fitted with.
function inside(area: GaragePinsDto, view: MapView, box: Box) {
  const { bottom, left, right, top } = paddingOf();
  return overlayOf(area, undefined, view, box).circles.every(
    ({ r, x, y }) =>
      x - r >= left &&
      y - r >= top &&
      x + r <= box.w - right &&
      y + r <= box.h - bottom,
  );
}
