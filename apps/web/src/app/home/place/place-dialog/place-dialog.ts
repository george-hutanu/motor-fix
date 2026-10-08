import {
  Component,
  DestroyRef,
  type ElementRef,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import {
  ADDRESS_MAX,
  inRomania,
  PLACE_SEARCH_MIN,
  PLACE_SUGGESTIONS_MAX,
} from '@motor-fix/contracts/place-section';
import { roundCoordinate } from '@motor-fix/contracts/search-place';
import { type PlaceSuggestionDto, PlacesService } from '@motor-fix/data-access';
import { I18n, TranslatePipe } from '@motor-fix/i18n';
import { injectOverlayTask } from '@motor-fix/overlays';
import { HlmInput, HlmLabel } from '@motor-fix/ui-cockpit';

import type { Place } from '../place-store';

const SEARCH_AFTER_MS = 300;
const LOCATE_TIMEOUT_MS = 10_000;

type Message = 'locationFailed' | 'nothingFound' | 'searchUnavailable';

// Where the search starts from: the browser's location, asked only on a tap,
// or an address picked from the look-up.
@Component({
  imports: [HlmInput, HlmLabel, TranslatePipe],
  selector: 'mf-place-dialog',
  styleUrl: './place-dialog.css',
  templateUrl: './place-dialog.html',
})
export class PlaceDialog {
  private readonly task = injectOverlayTask<undefined, Place>();
  private readonly places = inject(PlacesService);
  private readonly i18n = inject(I18n);
  private readonly field =
    viewChild.required<ElementRef<HTMLInputElement>>('field');
  private timer: ReturnType<typeof setTimeout> | undefined;
  // Each look-up and each key counts, so only the answer to the latest text
  // is shown.
  private asked = 0;

  constructor() {
    inject(DestroyRef).onDestroy(() => clearTimeout(this.timer));
  }

  protected readonly addressMax = ADDRESS_MAX;
  protected readonly geolocation =
    typeof navigator !== 'undefined' && Boolean(navigator.geolocation);
  protected readonly locating = signal(false);
  protected readonly suggestions = signal<PlaceSuggestionDto[]>([]);
  protected readonly active = signal(-1);
  protected readonly message = signal<Message | null>(null);

  protected locate() {
    this.locating.set(true);
    this.message.set(null);
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        if (inRomania(coords.latitude, coords.longitude)) {
          this.done(null, coords.latitude, coords.longitude, 'location');
        } else this.located();
      },
      () => this.located(),
      { timeout: LOCATE_TIMEOUT_MS },
    );
  }

  private located() {
    this.locating.set(false);
    this.message.set('locationFailed');
    this.field().nativeElement.focus();
  }

  protected type(event: Event) {
    const q = (event.target as HTMLInputElement).value.trim();
    clearTimeout(this.timer);
    this.asked++;
    this.suggestions.set([]);
    this.active.set(-1);
    this.message.set(null);
    if (q.length < PLACE_SEARCH_MIN) return;
    this.timer = setTimeout(() => this.search(q), SEARCH_AFTER_MS);
  }

  private async search(q: string) {
    const asked = ++this.asked;
    try {
      const { items } = await this.places.placesControllerSearch({
        lang: this.i18n.language(),
        q,
      });
      if (asked !== this.asked) return;
      this.suggestions.set(items.slice(0, PLACE_SUGGESTIONS_MAX));
      if (items.length === 0) this.message.set('nothingFound');
    } catch {
      if (asked === this.asked) this.message.set('searchUnavailable');
    }
  }

  protected choose({ label, lat, lng }: PlaceSuggestionDto) {
    this.done(label.slice(0, ADDRESS_MAX), lat, lng, 'address');
  }

  protected keys(event: KeyboardEvent) {
    const shown = this.suggestions();
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

  private done(
    label: string | null,
    lat: number,
    lng: number,
    origin: Place['origin'],
  ) {
    clearTimeout(this.timer);
    this.task.close({
      label,
      lat: roundCoordinate(lat),
      lng: roundCoordinate(lng),
      origin,
    });
  }
}
