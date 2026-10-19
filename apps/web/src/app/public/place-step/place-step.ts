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
  output,
  signal,
  viewChild,
} from '@angular/core';
import type { ListingCheck } from '@motor-fix/contracts/listing-check';
import type { BusinessKind } from '@motor-fix/contracts/listing-sections';
import {
  type PlaceSection,
  RADIUS_KM,
  radiusAllowed,
} from '@motor-fix/contracts/place-section';
import { TranslatePipe } from '@motor-fix/i18n';
import { HlmInput, HlmLabel } from '@motor-fix/ui-cockpit';

import { type LatLng, PLACE_MAP, type PlaceMap } from './place-map';
import {
  type AddressChoice,
  AddressField,
} from '../address-field/address-field';
import { type FieldMessage, FieldWatch, NO_PROBLEMS } from '../field-watch';

const ADDRESS = 'steps.5.place.address';
const POSITION = 'steps.5.place.lat';
const RADIUS = 'steps.5.place.radiusKm';

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
// the radius it travels. It holds the draft's section and saves nothing;
// the page judges it, and a field says what is wrong once it has been left,
// when it opens wrong, or when sending is asked for.
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AddressField, HlmInput, HlmLabel, TranslatePipe],
  selector: 'mf-place-step',
  styleUrl: './place-step.css',
  templateUrl: './place-step.html',
})
export class PlaceStep {
  readonly value = model<PlaceSection>({});
  readonly businessKind = input<BusinessKind | undefined>();
  // The page's judgement of this step, and whether sending was asked for.
  readonly problems = input<ListingCheck>(NO_PROBLEMS);
  readonly showAll = input(false);
  // Whether any field shows an error, for the step list's dot.
  readonly shown = output<boolean>();

  private readonly openMap = inject(PLACE_MAP);
  private readonly host = viewChild.required<ElementRef<HTMLElement>>('map');
  private readonly map = signal<PlaceMap | undefined>(undefined);
  private readonly watch = new FieldWatch();

  protected readonly radiusMin = RADIUS_KM.min;
  protected readonly radiusMax = RADIUS_KM.max;
  protected readonly mobile = computed(() => this.businessKind() === 'mobile');
  protected readonly armed = signal(false);
  protected readonly mapDown = signal(false);
  // What is typed in the radius field while it is not a radius to keep.
  private readonly radiusTyped = signal<string | null>(null);
  protected readonly radiusShown = computed(
    () =>
      this.radiusTyped() ?? String(this.value().radiusKm ?? RADIUS_KM.default),
  );
  protected readonly hasPin = computed(
    () => positionOf(this.value()) !== undefined,
  );

  // What each field shows; a mobile mechanic's place reads as the seat.
  protected readonly messages = computed(() => {
    const value = this.value();
    const check = this.problems();
    const all = this.showAll();
    const mobile = this.mobile();
    const message = (field: string, filled: boolean) =>
      this.watch.message(check, field, { all, filled, mobile });
    // A radius typed out of range is never kept, so the page cannot judge it.
    const typed: FieldMessage | null =
      this.radiusTyped() === null
        ? null
        : { key: 'public.listing.place.radiusHint', warning: false };
    return {
      address: message(ADDRESS, !!value.address?.trim()),
      position: message(POSITION, this.hasPin()),
      radius: mobile
        ? (typed ?? message(RADIUS, value.radiusKm !== undefined))
        : null,
    };
  });
  protected readonly errors = computed(() => {
    const { address, position, radius } = this.messages();
    const error = (message: FieldMessage | null) =>
      message && !message.warning ? message.key : null;
    return {
      address: error(address),
      position: error(position),
      radius: error(radius),
    };
  });

  constructor() {
    const destroyRef = inject(DestroyRef);
    let destroyed = false;
    destroyRef.onDestroy(() => {
      destroyed = true;
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
    effect(() => this.shown.emit(Object.values(this.errors()).some(Boolean)));
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

  protected type(typed: string) {
    this.watch.type(ADDRESS);
    // A typed address is no longer the suggestion the town came with.
    const { address: _, locality: __, ...rest } = this.value();
    this.value.set(typed ? { ...rest, address: typed } : rest);
  }

  protected choose({ label, lat, lng, locality }: AddressChoice) {
    this.value.update(({ locality: _, ...value }) => ({
      ...value,
      ...(label !== null && { address: label }),
      lat,
      lng,
      ...(locality && { locality }),
    }));
  }

  protected leave(field: 'address' | 'radius') {
    this.watch.leave(field === 'address' ? ADDRESS : RADIUS);
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
    this.watch.type(RADIUS);
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
}
