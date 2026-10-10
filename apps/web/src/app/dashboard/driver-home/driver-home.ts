import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  type CarDto,
  CarsService,
  type RequestSummaryDto,
  RequestsService,
} from '@motor-fix/data-access';
import { I18n, TranslatePipe } from '@motor-fix/i18n';
import { Overlays } from '@motor-fix/overlays';
import { HlmButton, Panel } from '@motor-fix/ui-cockpit';

import { openAddCar } from '../add-car/open-add-car';
import { EmptyState } from '../empty-state/empty-state';
import { Session } from '../session';
import { allowedViews } from '../views';

// A list as a panel reads it: loading (undefined), failed, or its items.
type Read<T> = T[] | 'failed' | undefined;

const ENDED: readonly RequestSummaryDto['status'][] = ['done', 'closed'];

// "Panou", the driver dashboard's first view: the panel grid, each panel in
// its loading, empty or error state, and, with no active request, the
// invitations to add a car and to find a garage. ST-29 fills the panels.
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [EmptyState, HlmButton, Panel, RouterLink, TranslatePipe],
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
    const cars = this.cars();
    const requests = this.requests();
    if (cars === undefined || requests === undefined) return 'loading';
    if (cars === 'failed' || requests === 'failed') return 'failed';
    return requests.some((r) => !ENDED.includes(r.status))
      ? 'active'
      : 'invite';
  });
  protected readonly hasCar = computed(() => {
    const cars = this.cars();
    return Array.isArray(cars) && cars.length > 0;
  });
  protected readonly quotes = computed(() =>
    this.filter((r) => r.quotesCount > 0),
  );
  protected readonly repairs = computed(() =>
    this.filter((r) => r.status === 'done'),
  );
  protected readonly saved = computed(() =>
    allowedViews('driver', this.session.current()?.capabilities ?? []).some(
      (view) => view.path === 'saved',
    ),
  );

  constructor() {
    void this.i18n.enter('driver');
    this.load();
  }

  protected async addCar() {
    const cars = this.cars();
    const plates = Array.isArray(cars)
      ? cars.flatMap((c) => c.plate ?? [])
      : [];
    const car = await openAddCar(this.overlays, plates);
    if (car === 'cancelled') return;
    this.cars.update((list) => [car, ...(Array.isArray(list) ? list : [])]);
  }

  // Each list settles its own panels; the first row waits for both.
  private load() {
    this.carsApi.carsControllerList().then(
      ({ items }) => this.cars.set(items),
      () => this.cars.set('failed'),
    );
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
