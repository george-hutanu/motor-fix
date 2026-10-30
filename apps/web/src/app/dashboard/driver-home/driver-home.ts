import { isPlatformBrowser } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  inject,
  PLATFORM_ID,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  type CarDto,
  CarsService,
  type RequestSummaryDto,
  RequestsService,
} from '@motor-fix/data-access';
import { I18n, KmPipe, TranslatePipe } from '@motor-fix/i18n';
import { Overlays } from '@motor-fix/overlays';
import { HlmButton, Panel } from '@motor-fix/ui-cockpit';

import { ActiveRequest } from '../active-request/active-request';
import { openAddCar } from '../add-car/open-add-car';
import { carLines, compareCars } from '../car-lines/car-lines';
import { DRIVER_PANELS, panelsToDraw } from '../driver-panels/driver-panels';
import { DueDateLine } from '../due-date-line/due-date-line';
import { EmptyState } from '../empty-state/empty-state';
import { ACTIVE_REQUEST_EVENTS, Live, liveResource } from '../live';
import { OilLine } from '../oil-line/oil-line';
import { openRequestOf } from '../quotes-compare/compare-rules/compare-rules';
import { QuotesCompare } from '../quotes-compare/quotes-compare';
import { SavedGaragesList } from '../saved-garages/saved-garages-list';
import { SavedGaragesPanel } from '../saved-garages/saved-garages-panel/saved-garages-panel';
import { Session } from '../session';
import { TiePipe } from '../tie/tie';
import { allowedViews } from '../views';

// A list as a panel reads it: loading (undefined), failed, or its items.
type Read<T> = T[] | 'failed' | undefined;

// The cars the panel shows; the rest are a link away.
const CARS_SHOWN = 3;
// How often a page left open reads the clock again, so the cars rank by the
// new day soon after midnight with no new read.
const TICK_MS = 60_000;

// "Panou", the driver dashboard's first view: the registry's panels, each in
// its loading, empty, filled or error state, and, with no active request, the
// invitations to add a car and to find a garage.
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ActiveRequest,
    DueDateLine,
    EmptyState,
    HlmButton,
    KmPipe,
    OilLine,
    Panel,
    QuotesCompare,
    RouterLink,
    SavedGaragesPanel,
    TiePipe,
    TranslatePipe,
  ],
  selector: 'mf-driver-home',
  styleUrl: './driver-home.css',
  templateUrl: './driver-home.html',
})
export class DriverHome {
  private readonly carsApi = inject(CarsService);
  private readonly requestsApi = inject(RequestsService);
  private readonly i18n = inject(I18n);
  private readonly overlays = inject(Overlays);
  private readonly session = inject(Session);
  protected readonly language = this.i18n.language;
  protected readonly cars = signal<Read<CarDto>>(undefined);
  // The requests, re-read when a quote is accepted, a booking is confirmed,
  // lapses or is cancelled, a request is cancelled, and after a resync; the
  // last read wins.
  private readonly requestsRead = liveResource(
    () => this.requestsApi.requestsControllerList(),
    [
      'quote.accepted',
      'booking.confirmed',
      'booking.lapsed',
      'booking.cancelled',
      'request.cancelled',
    ],
  );
  protected readonly requests = computed(
    (): Read<RequestSummaryDto> =>
      this.requestsRead.failed() && !this.requestsRead.value()
        ? 'failed'
        : this.requestsRead.value()?.items,
  );
  // The active request, re-read on every change to a request, its quotes,
  // booking or job, and after a resync; the last read wins.
  private readonly activeRead = liveResource(
    () => this.requestsApi.activeRequestControllerGet(),
    ACTIVE_REQUEST_EVENTS,
  );
  // The live stream down past its grace: the panel says it is reconnecting.
  protected readonly reconnecting = inject(Live).offline;
  protected readonly active = computed(() =>
    this.activeRead.failed() && !this.activeRead.value()
      ? 'failed'
      : this.activeRead.value(),
  );
  // The active request's panel, or the invitations once the read says no
  // request is open.
  protected readonly firstRow = computed(() => {
    const active = this.active();
    return active !== undefined && active !== 'failed' && !active.request
      ? 'invite'
      : 'active';
  });
  protected readonly hasCar = computed(() => this.carCount() > 0);
  // Only a list read and empty asks for a first car.
  protected readonly noCar = computed(() => {
    const cars = this.cars();
    return Array.isArray(cars) && cars.length === 0;
  });
  protected readonly carCount = computed(() => {
    const cars = this.cars();
    return Array.isArray(cars) ? cars.length : 0;
  });
  protected readonly wide = new Set(
    DRIVER_PANELS.filter((p) => p.wide).map((p) => p.key),
  );
  // The request whose quotes the panel compares: the newest still open.
  protected readonly quotes = computed((): Read<string> => {
    const requests = this.requests();
    if (!Array.isArray(requests)) return requests;
    const open = openRequestOf(requests);
    return open ? [open.id] : [];
  });
  protected readonly repairs = computed(() =>
    this.filter((r) => r.status === 'done'),
  );
  protected readonly saved = computed(() =>
    // Stryker disable next-line ArrayDeclaration: any capability but saved_garages hides the panel alike.
    allowedViews('driver', this.session.shown()?.capabilities ?? []).some(
      (view) => view.path === 'saved',
    ),
  );
  private readonly savedList = inject(SavedGaragesList);
  // As the other panels: only a list with rows links its heading.
  protected readonly savedLink = computed(() =>
    this.savedList.rows()?.length ? ['/app', 'driver', 'saved'] : undefined,
  );
  // The cars as the saved panel reads them: undefined until known.
  protected readonly carList = computed(() => {
    const cars = this.cars();
    return Array.isArray(cars) ? cars : undefined;
  });
  protected readonly panels = computed(() =>
    panelsToDraw(null).filter((key) => key !== 'saved' || this.saved()),
  );
  protected readonly carsShown = CARS_SHOWN;
  private readonly now = signal(new Date());
  // The most urgent cars, each with its two most urgent lines.
  protected readonly topCars = computed(() => {
    const cars = this.cars();
    if (!Array.isArray(cars)) return [];
    const now = this.now();
    return [...cars]
      .sort((a, b) => compareCars(a, b, now))
      .slice(0, CARS_SHOWN)
      .map((car) => ({ car, lines: carLines(car, now).slice(0, 2) }));
  });

  constructor() {
    void this.i18n.enter('driver');
    this.loadCars();
    if (!isPlatformBrowser(inject(PLATFORM_ID))) return;
    const tick = setInterval(() => this.now.set(new Date()), TICK_MS);
    inject(DestroyRef).onDestroy(() => clearInterval(tick));
  }

  // Both add buttons show only once the driver is known to have no car, so no
  // plate is taken yet.
  protected async addCar() {
    const car = await openAddCar(this.overlays, []);
    if (car === 'cancelled') return;
    this.cars.update((list) => [car, ...(Array.isArray(list) ? list : [])]);
  }

  protected retryActive() {
    this.activeRead.reload();
  }

  protected retryCars() {
    this.cars.set(undefined);
    this.loadCars();
  }

  private loadCars() {
    this.carsApi.carsControllerList().then(
      ({ items }) => this.cars.set(items),
      () => this.cars.set('failed'),
    );
  }

  protected state(list: Read<unknown>) {
    if (list === undefined || list === 'failed') return list ?? 'loading';
    return list.length ? 'filled' : 'empty';
  }

  private filter(keep: (request: RequestSummaryDto) => boolean) {
    const requests = this.requests();
    return Array.isArray(requests) ? requests.filter(keep) : requests;
  }
}
