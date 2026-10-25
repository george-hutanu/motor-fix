import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import {
  afterNextRender,
  Component,
  computed,
  DestroyRef,
  ElementRef,
  inject,
  input,
  linkedSignal,
  output,
  PLATFORM_ID,
  signal,
} from '@angular/core';
import {
  bucketFor,
  type LatLng,
  type StaticMapTheme,
  staticMapPath,
} from '@motor-fix/contracts/map-view';
import type { GaragePinsDto } from '@motor-fix/data-access';
import { TranslatePipe } from '@motor-fix/i18n';
import { HlmButton } from '@motor-fix/ui-cockpit';

import type { Box, MapView } from './fit-view';
import { overlayOf, quietLabels } from './overlay';

// A map shown as one image of its ground with the pins drawn over it, which
// asks its host for the interactive map on a tap, a click or its button. The
// image and the overlay are decorative: the page's list is the accessible
// path, so only the button takes the focus.
@Component({
  host: { '(click)': 'activate.emit()' },
  imports: [HlmButton, TranslatePipe],
  selector: 'mf-static-map',
  styleUrl: './static-map.css',
  templateUrl: './static-map.html',
})
export class StaticMap {
  // None while the host has nothing to frame yet, as while a search runs.
  readonly view = input<MapView | undefined>();
  readonly pins = input<GaragePinsDto | undefined>();
  readonly place = input<LatLng | undefined>();
  readonly lit = input<string | undefined>();
  readonly activate = output<void>();

  // The map box as laid out; none on the server and before the first measure.
  private readonly box = signal<Box | undefined>(undefined);
  private readonly theme = signal<StaticMapTheme>('light');

  protected readonly src = computed(() => {
    const view = this.view();
    const box = this.box();
    if (!view || !box) return undefined;
    return staticMapPath({
      h: bucketFor(box.h, 'h'),
      lat: view.center.lat,
      lng: view.center.lng,
      theme: this.theme(),
      w: bucketFor(box.w),
      z: view.zoom,
    });
  });
  // A failed image leaves the grey ground; a new view tries again.
  protected readonly broken = linkedSignal({
    computation: () => false,
    source: this.src,
  });
  protected readonly overlay = computed(() => {
    const view = this.view();
    const box = this.box();
    if (!view || !box || this.broken()) return undefined;
    return overlayOf(this.pins(), this.place(), view, box);
  });
  // The rates that give way to one they would cover, the lit one first.
  protected readonly quiet = computed(() =>
    quietLabels(this.overlay()?.pins ?? [], this.lit()),
  );

  constructor() {
    if (!isPlatformBrowser(inject(PLATFORM_ID))) return;
    const element = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
    const destroyRef = inject(DestroyRef);
    const scheme = inject(DOCUMENT).defaultView?.matchMedia?.(
      '(prefers-color-scheme: dark)',
    );
    if (scheme) {
      const follow = ({ matches }: { matches: boolean }) =>
        this.theme.set(matches ? 'dark' : 'light');
      follow(scheme);
      scheme.addEventListener('change', follow);
      destroyRef.onDestroy(() => scheme.removeEventListener('change', follow));
    }
    const measure = () => {
      // Whole pixels, as the host measures the box it frames.
      const w = element.clientWidth;
      const h = element.clientHeight;
      const now = this.box();
      if (w <= 0 || h <= 0) return;
      if (now?.w !== w || now?.h !== h) this.box.set({ h, w });
    };
    afterNextRender(() => {
      measure();
      if (typeof ResizeObserver === 'undefined') return;
      const resized = new ResizeObserver(measure);
      resized.observe(element);
      destroyRef.onDestroy(() => resized.disconnect());
    });
  }
}
