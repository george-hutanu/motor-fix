import {
  computed,
  effect,
  Injectable,
  inject,
  linkedSignal,
  untracked,
} from '@angular/core';
import { nearOf } from '@motor-fix/contracts/search-place';
import {
  PlacesService,
  type SavedGarageItemDto,
  SavedGaragesService,
} from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';

import { PlaceStore } from '../../home/place/place-store';
import { SavedGarages } from '../../public/saved-garages/saved-garages';
import { liveResource } from '../live';
import { Session } from '../session';

// The driver's saved garages, newest first, measured from the place Home
// keeps (else the Setări city): Panou's panel and the Service-uri salvate view
// both read this. Another tab's save or removal reads the first page again.
@Injectable({ providedIn: 'root' })
export class SavedGaragesList {
  private readonly api = inject(SavedGaragesService);
  private readonly places = inject(PlacesService);
  private readonly store = inject(PlaceStore);
  private readonly saved = inject(SavedGarages);
  private readonly session = inject(Session);
  private readonly i18n = inject(I18n);

  private readonly near = computed(() => {
    const place = this.store.place();
    return place ? nearOf(place) : undefined;
  });
  private readonly view = liveResource(
    () => this.api.savedGaragesControllerList(this.query()),
    ['saved_garage.added', 'saved_garage.removed'],
  );
  // Rows removed from this tab since the last read, each with its row when
  // the first page held it; one undone or refused shows again.
  private readonly removed = linkedSignal<
    number,
    ReadonlyMap<string, SavedGarageItemDto | undefined>
  >({ computation: () => new Map(), source: this.view.reads });
  private readonly hidden = computed(() => {
    const ids = this.saved.ids();
    return [...this.removed()].filter(([id]) => !ids.has(id));
  });
  private opened = false;
  private cityAsked: string | null = null;

  // Moves on every read, even one that equals the last.
  readonly reads = this.view.reads;
  readonly rows = computed(() => {
    const items = this.view.value()?.items;
    return items && this.visible(items);
  });
  readonly nextCursor = computed(() => this.view.value()?.nextCursor);
  readonly total = computed(() => {
    const total = this.view.value()?.total;
    return total === undefined ? undefined : total - this.hidden().length;
  });
  readonly workingCount = computed(() => {
    const count = this.view.value()?.workingCount;
    if (count === undefined) return undefined;
    return count - this.hidden().filter(([, row]) => row?.brands.length).length;
  });
  readonly loading = this.view.isLoading;
  // The first read failed and there is nothing to show.
  readonly failed = computed(() => this.view.error() !== undefined);

  constructor() {
    let near = this.near();
    effect(() => {
      const now = this.near();
      if (now === near) return;
      near = now;
      untracked(() => this.view.reload());
    });
    effect(() => {
      const city = this.session.current()?.city;
      if (!city || city === this.cityAsked || this.store.place()) return;
      this.cityAsked = city;
      untracked(() => void this.fromCity(city));
    });
  }

  // Each screen that shows the list reads it anew; the first is already reading.
  open() {
    if (this.opened) this.view.reload();
    this.opened = true;
  }

  reload() {
    this.view.reload();
  }

  page(cursor: string) {
    return this.api.savedGaragesControllerList(this.query(cursor));
  }

  // At once, through ST-290's removal with its undo bar.
  remove(garageId: string, row?: SavedGarageItemDto) {
    const known =
      row ??
      this.view.value()?.items.find((item) => item.garageId === garageId);
    this.removed.update((rows) => new Map(rows).set(garageId, known));
    return this.saved.remove(garageId);
  }

  // The rows still saved, for a further page too.
  visible(rows: readonly SavedGarageItemDto[]) {
    const hidden = new Set(this.hidden().map(([id]) => id));
    return hidden.size ? rows.filter((row) => !hidden.has(row.garageId)) : rows;
  }

  private query(cursor?: string) {
    const near = this.near();
    return {
      ...(cursor ? { cursor } : {}),
      ...(near ? { near } : {}),
    };
  }

  // As Home does: a failed or empty look-up measures nothing.
  private async fromCity(city: string) {
    const items = await this.places
      .placesControllerSearch({ lang: this.i18n.language(), q: city })
      .then((answer) => answer.items)
      .catch(() => []);
    const [first] = items;
    if (!first || this.store.place()) return;
    this.store.use({
      label: city,
      lat: first.lat,
      lng: first.lng,
      origin: 'address',
    });
  }
}
