import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  type ElementRef,
  inject,
  input,
  model,
  output,
  signal,
  viewChild,
} from '@angular/core';
import {
  ADDRESS_MAX,
  inRomania,
  PLACE_SEARCH_MIN,
  PLACE_SUGGESTIONS_MAX,
} from '@motor-fix/contracts/place-section';
import { type PlaceSuggestionDto, PlacesService } from '@motor-fix/data-access';
import { I18n, TranslatePipe } from '@motor-fix/i18n';
import { HlmInput, HlmLabel } from '@motor-fix/ui-cockpit';

const SEARCH_AFTER_MS = 300;
const LOCATE_TIMEOUT_MS = 10_000;

type Message = 'locationFailed' | 'nothingFound' | 'searchUnavailable';

// A place given by the driver: a suggestion picked, with its town when the
// look-up names one, or the browser's location, which has no label. The
// point is as found; whoever keeps it rounds it.
export interface AddressChoice {
  label: string | null;
  lat: number;
  lng: number;
  origin: 'address' | 'location';
  locality?: string;
}

// Where a field's placeholder, its messages and its count are read from:
// Home's place texts, or the listing's, which point to the map.
type AddressTexts = 'public.home.place' | 'public.listing.place';

// The address look-up: a combobox that asks from the third character, a
// pause after the last key, in the page's language, and shows only the
// answer to the latest text; the arrows and Enter walk and take a
// suggestion, Escape closes the list. The browser's location is offered
// on a tap when asked for.
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [HlmInput, HlmLabel, TranslatePipe],
  selector: 'mf-address-field',
  styleUrl: './address-field.css',
  templateUrl: './address-field.html',
})
export class AddressField {
  // Prefix of the ids the label, the list and the message are wired by.
  readonly ids = input.required<string>();
  // The label shown, already in the page's language; "Adresă" by default.
  readonly label = input<string>();
  readonly locate = input(false);
  readonly autofocus = input(false);
  readonly texts = input<AddressTexts>('public.home.place');
  // What the field holds: it follows each key, and a page that keeps the
  // address sets it.
  readonly text = model('');
  // A page's own notes on the field, read after its message, and whether
  // one of them is an error.
  readonly describedBy = input('');
  readonly invalid = input(false);
  // The path a page's summary finds the field by.
  readonly path = input<string>();
  readonly chosen = output<AddressChoice>();
  readonly left = output<void>();

  private readonly places = inject(PlacesService);
  private readonly i18n = inject(I18n);
  private readonly destroyRef = inject(DestroyRef);
  private readonly field =
    viewChild.required<ElementRef<HTMLInputElement>>('field');
  private timer: ReturnType<typeof setTimeout> | undefined;
  // Each look-up and each key counts, so only the answer to the latest text
  // is shown.
  private asked = 0;
  private lastAsked = '';

  protected readonly addressMax = ADDRESS_MAX;
  protected readonly geolocation =
    typeof navigator !== 'undefined' && Boolean(navigator.geolocation);
  protected readonly locating = signal(false);
  protected readonly suggestions = signal<PlaceSuggestionDto[]>([]);
  protected readonly active = signal(-1);
  protected readonly message = signal<Message | null>(null);
  protected readonly words = computed(() => {
    const texts = this.texts();
    return {
      found: `${texts}.found`,
      nothingFound: `${texts}.nothingFound`,
      placeholder: `${texts}.placeholder`,
      searchUnavailable: `${texts}.searchUnavailable`,
    };
  });

  constructor() {
    this.destroyRef.onDestroy(() => {
      clearTimeout(this.timer);
      this.asked++;
    });
    afterNextRender(() => {
      if (this.autofocus()) this.focus();
    });
  }

  private focus() {
    this.field().nativeElement.focus();
  }

  // An answer after the field is gone is dropped.
  protected findMe() {
    this.locating.set(true);
    this.message.set(null);
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        if (this.destroyRef.destroyed) return;
        const { latitude: lat, longitude: lng } = coords;
        if (!inRomania(lat, lng)) return this.located();
        this.locating.set(false);
        this.chosen.emit({ label: null, lat, lng, origin: 'location' });
      },
      () => {
        if (!this.destroyRef.destroyed) this.located();
      },
      { timeout: LOCATE_TIMEOUT_MS },
    );
  }

  private located() {
    this.locating.set(false);
    this.message.set('locationFailed');
    this.focus();
  }

  protected type(event: Event) {
    const typed = (event.target as HTMLInputElement).value;
    this.text.set(typed);
    const q = typed.trim();
    // Spaces around the text asked last change nothing to ask.
    if (q && q === this.lastAsked) return;
    this.close();
    this.message.set(null);
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
      if (items.length === 0) this.message.set('nothingFound');
    } catch {
      if (asked !== this.asked) return;
      this.lastAsked = '';
      this.message.set('searchUnavailable');
    }
  }

  protected choose({ label, lat, lng, locality }: PlaceSuggestionDto) {
    this.close();
    this.chosen.emit({
      label: label.slice(0, ADDRESS_MAX),
      lat,
      lng,
      ...(locality ? { locality } : {}),
      origin: 'address',
    });
  }

  protected keys(event: KeyboardEvent) {
    const shown = this.suggestions();
    if (event.key === 'Escape') {
      this.close();
      // Only an open list closes; a dialog around the field stays open.
      if (shown.length > 0) event.stopPropagation();
      return;
    }
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

  // Closes the list and forgets any look-up still on its way.
  private close() {
    clearTimeout(this.timer);
    this.asked++;
    this.lastAsked = '';
    this.suggestions.set([]);
    this.active.set(-1);
  }
}
