import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  type ElementRef,
  effect,
  inject,
  input,
  model,
  signal,
  viewChild,
} from '@angular/core';
import type { BusinessKind } from '@motor-fix/contracts/listing-sections';
import {
  ADDRESS_MAX,
  inRomania,
  PLACE_SEARCH_MIN,
  PLACE_SUGGESTIONS_MAX,
  type PlaceSection,
  RADIUS_KM,
  radiusAllowed,
} from '@motor-fix/contracts/place-section';
import { type PlaceSuggestionDto, PlacesService } from '@motor-fix/data-access';
import { I18n, TranslatePipe } from '@motor-fix/i18n';
import { HlmInput, HlmLabel } from '@motor-fix/ui-cockpit';

import { type LatLng, PLACE_MAP, type PlaceMap } from './place-map';

const SEARCH_AFTER_MS = 300;
// One arrow key moves the pin about 20 m.
const NUDGE = 0.0002;
const NUDGES: Record<string, [number, number]> = {
  ArrowDown: [-NUDGE, 0],
  ArrowLeft: [0, -NUDGE],
  ArrowRight: [0, NUDGE],
  ArrowUp: [NUDGE, 0],
};

const positionOf = ({ lat, lng }: PlaceSection): LatLng | undefined =>
  lat === undefined || lng === undefined ? undefined : { lat, lng };

// The place of step 5: the address, found by search or typed, and the pin
// on the map, dropped by a suggestion, moved by a drag, a tap once armed or
// the arrow keys. A mobile mechanic gives its registered seat instead and
// the radius it travels. It holds the draft's section and saves nothing.
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [HlmInput, HlmLabel, TranslatePipe],
  selector: 'mf-place-step',
  styleUrl: './place-step.css',
  templateUrl: './place-step.html',
})
export class PlaceStep {
  readonly value = model<PlaceSection>({});
  readonly businessKind = input<BusinessKind | undefined>();

  private readonly i18n = inject(I18n);
  private readonly places = inject(PlacesService);
  private readonly openMap = inject(PLACE_MAP);
  private readonly host = viewChild.required<ElementRef<HTMLElement>>('map');
  private readonly map = signal<PlaceMap | undefined>(undefined);
  private timer: ReturnType<typeof setTimeout> | undefined;
  // Only the answer to the latest text is shown.
  private asked = 0;
  private lastAsked = '';

  protected readonly addressMax = ADDRESS_MAX;
  protected readonly radiusMin = RADIUS_KM.min;
  protected readonly radiusMax = RADIUS_KM.max;
  protected readonly mobile = computed(() => this.businessKind() === 'mobile');
  protected readonly suggestions = signal<PlaceSuggestionDto[]>([]);
  protected readonly active = signal(-1);
  protected readonly nothingFound = signal(false);
  protected readonly searchDown = signal(false);
  protected readonly armed = signal(false);
  protected readonly outside = computed(() => {
    const at = positionOf(this.value());
    return !!at && !inRomania(at.lat, at.lng);
  });
  protected readonly mapDown = signal(false);
  // What is typed in the radius field while it is not a radius to keep.
  private readonly radiusTyped = signal<string | null>(null);
  protected readonly radiusShown = computed(
    () =>
      this.radiusTyped() ?? String(this.value().radiusKm ?? RADIUS_KM.default),
  );
  protected readonly radiusInvalid = computed(
    () => this.radiusTyped() !== null,
  );
  protected readonly hasPin = computed(
    () => positionOf(this.value()) !== undefined,
  );

  constructor() {
    const destroyRef = inject(DestroyRef);
    let destroyed = false;
    destroyRef.onDestroy(() => {
      destroyed = true;
      clearTimeout(this.timer);
      this.map()?.destroy();
    });
    afterNextRender(() => {
      this.openMap(this.host().nativeElement, {
        dragged: (at) => this.place(at),
        failed: () => this.mapDown.set(true),
        recovered: () => this.mapDown.set(false),
        tapped: (at) => {
          if (!this.armed()) return;
          this.armed.set(false);
          // A placed pin is moved by dragging, never by a tap.
          if (!this.hasPin()) this.place(at);
        },
      }).then(
        (map) => (destroyed ? map.destroy() : this.map.set(map)),
        () => this.mapDown.set(true),
      );
    });
    // One call, so a pin and a radius set together move the view once.
    effect(() =>
      this.map()?.show({
        at: positionOf(this.value()),
        km: this.mobile()
          ? (this.value().radiusKm ?? RADIUS_KM.default)
          : undefined,
      }),
    );
  }

  protected type(event: Event) {
    const typed = (event.target as HTMLInputElement).value;
    // A typed address is no longer the suggestion the town came with.
    const { address: _, locality: __, ...rest } = this.value();
    this.value.set(typed ? { ...rest, address: typed } : rest);
    const q = typed.trim();
    // Spaces around the text asked last change nothing to ask.
    if (q && q === this.lastAsked) return;
    clearTimeout(this.timer);
    this.asked++;
    this.close();
    this.nothingFound.set(false);
    this.searchDown.set(false);
    if (q.length < PLACE_SEARCH_MIN) return;
    this.timer = setTimeout(() => this.search(q), SEARCH_AFTER_MS);
  }

  private async search(q: string) {
    const asked = ++this.asked;
    this.lastAsked = q;
    try {
      const { items } = await this.places.placesControllerSearch({
        lang: this.i18n.language(),
        q,
      });
      if (asked !== this.asked) return;
      this.suggestions.set(items.slice(0, PLACE_SUGGESTIONS_MAX));
      this.nothingFound.set(items.length === 0);
    } catch {
      if (asked !== this.asked) return;
      this.lastAsked = '';
      this.searchDown.set(true);
    }
  }

  protected choose({ label, lat, lng, locality }: PlaceSuggestionDto) {
    clearTimeout(this.timer);
    this.asked++;
    this.close();
    // The draft refuses a longer address, so a longer label is cut to fit.
    const address = label.slice(0, ADDRESS_MAX);
    this.value.update(({ locality: _, ...value }) => ({
      ...value,
      address,
      lat,
      lng,
      ...(locality && { locality }),
    }));
  }

  protected keys(event: KeyboardEvent) {
    const shown = this.suggestions();
    if (event.key === 'Escape') return this.close();
    if (shown.length === 0) return;
    const moves: Record<string, number> = { ArrowDown: 1, ArrowUp: -1 };
    if (event.key in moves) {
      event.preventDefault();
      this.active.update(
        (i) => (i + moves[event.key] + shown.length) % shown.length,
      );
    } else if (event.key === 'Enter' && this.active() >= 0) {
      event.preventDefault();
      this.choose(shown[this.active()]);
    }
  }

  protected arm() {
    this.armed.set(true);
  }

  protected nudge(event: KeyboardEvent) {
    const move = NUDGES[event.key];
    const at = positionOf(this.value());
    if (!move || !at) return;
    event.preventDefault();
    this.place({ lat: at.lat + move[0], lng: at.lng + move[1] });
  }

  protected typeRadius(event: Event) {
    const typed = (event.target as HTMLInputElement).value.trim();
    const km = /^\d+$/.test(typed) ? Number(typed) : Number.NaN;
    if (!radiusAllowed(km)) {
      this.radiusTyped.set(typed);
      return;
    }
    this.radiusTyped.set(null);
    this.value.update((value) => ({ ...value, radiusKm: km }));
  }

  private place(at: LatLng) {
    this.value.update((value) => ({ ...value, lat: at.lat, lng: at.lng }));
  }

  private close() {
    this.lastAsked = '';
    this.suggestions.set([]);
    this.active.set(-1);
  }
}
