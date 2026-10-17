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
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
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

import { openAddCar } from '../add-car/open-add-car';
import { carLines, compareCars } from '../car-lines/car-lines';
import { DRIVER_PANELS, panelsToDraw } from '../driver-panels/driver-panels';
import { DueDateLine } from '../due-date-line/due-date-line';
import { EmptyState } from '../empty-state/empty-state';
import { Live } from '../live';
import { OilLine } from '../oil-line/oil-line';
import { Session } from '../session';
import { TiePipe } from '../tie/tie';
import { allowedViews } from '../views';

// A list as a panel reads it: loading (undefined), failed, or its items.
type Read<T> = T[] | 'failed' | undefined;

const ENDED: readonly RequestSummaryDto['status'][] = ['done', 'closed'];

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
    DueDateLine,
    EmptyState,
    HlmButton,
    KmPipe,
    OilLine,
    Panel,
    RouterLink,
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
  protected readonly requests = signal<Read<RequestSummaryDto>>(undefined);
  protected readonly firstRow = computed(() => {
    const requests = this.requests();
    if (requests === undefined || requests === 'failed')
      return requests ?? 'loading';
    return requests.some((r) => !ENDED.includes(r.status))
      ? 'active'
      : 'invite';
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
  protected readonly quotes = computed(() =>
    this.filter((r) => r.quotesCount > 0),
  );
  protected readonly repairs = computed(() =>
    this.filter((r) => r.status === 'done'),
  );
  protected readonly saved = computed(() =>
    // Stryker disable next-line ArrayDeclaration: any capability but saved_garages hides the panel alike.
    allowedViews('driver', this.session.shown()?.capabilities ?? []).some(
      (view) => view.path === 'saved',
    ),
  );
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
    this.load();
    // An accepted quote books the request: its panels read it again.
    inject(Live)
      .on(['quote.accepted'])
      .pipe(takeUntilDestroyed())
      .subscribe(() => this.loadRequests());
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

  protected retryCars() {
    this.cars.set(undefined);
    this.loadCars();
  }

  // Each list settles its own panels; the first row follows the requests.
  private load() {
    this.loadCars();
    this.loadRequests();
  }

  private loadCars() {
    this.carsApi.carsControllerList().then(
      ({ items }) => this.cars.set(items),
      () => this.cars.set('failed'),
    );
  }

  private loadRequests() {
    this.requestsApi.requestsControllerList().then(
      ({ items }) => this.requests.set(items),
      () => this.requests.set('failed'),
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
