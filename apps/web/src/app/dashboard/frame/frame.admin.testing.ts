import { HttpErrorResponse } from '@angular/common/http';
import { computed, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import type { EventKind, LiveMessage } from '@motor-fix/contracts';
import {
  AdminService,
  CarsService,
  type MeDto,
  MeService,
  NotificationsService,
} from '@motor-fix/data-access';
import { filter, Subject } from 'rxjs';

import { Frame } from './frame';
import { Live } from '../live';
import { Session } from '../session';
import { dashboardRoutes } from '../views';

// The admin frame over a fake overview that answers by city, for the specs of
// the header's city and period.
export type Params = { city?: string; period?: string } | undefined;

const CITIES = [
  { garages: 214, key: 'all', name: 'România' },
  { garages: 120, key: 'bucuresti', name: 'București' },
  { garages: 31, key: 'cluj-napoca', name: 'Cluj-Napoca' },
];
const CITY_WAITING: Record<string, number> = {
  bucuresti: 3,
  'cluj-napoca': 1,
};

export async function renderAdmin(url = '/app/admin') {
  Element.prototype.scrollIntoView = jest.fn();
  const asked: Params[] = [];
  const events = new Subject<LiveMessage>();
  const me = signal<MeDto | null>({
    capabilities: [
      'admin.garages',
      'admin.users',
      'admin.reviews',
      'admin.catalogue',
      'admin.settings',
    ],
    email: null,
    garageId: null,
    id: 'account-1',
    landing: '/app/admin',
    language: 'ro',
    name: 'Ioana Pop',
    role: 'admin',
    roles: ['admin'],
  } as unknown as MeDto);
  TestBed.configureTestingModule({
    providers: [
      provideRouter(
        (['driver', 'garage', 'admin'] as const).map((area) => ({
          children: dashboardRoutes(area),
          component: Frame,
          path: `app/${area}`,
        })),
      ),
      {
        provide: Session,
        useValue: {
          current: me,
          ended: new Subject<void>(),
          reload: jest.fn(async () => undefined),
          shown: computed(() => me()),
          signOut: jest.fn(),
        },
      },
      {
        provide: Live,
        useValue: {
          close: jest.fn(),
          events,
          offline: signal(false),
          on: (kinds: readonly EventKind[]) =>
            events.pipe(
              filter((m) => (kinds as readonly string[]).includes(m.kind)),
            ),
          open: jest.fn(),
          resync: new Subject<void>(),
        },
      },
      {
        provide: NotificationsService,
        useValue: { bellControllerUnreadCount: async () => ({ count: 0 }) },
      },
      { provide: MeService, useValue: {} },
      {
        provide: CarsService,
        useValue: { carsControllerList: async () => ({ items: [] }) },
      },
      {
        provide: AdminService,
        useValue: {
          adminOverviewControllerGrowth: async () => ({ months: [] }),
          adminOverviewControllerOverview: async (params: Params) => {
            asked.push(params);
            const city = params?.city;
            if (city && !(city in CITY_WAITING))
              throw new HttpErrorResponse({
                error: {
                  code: 'validation_failed',
                  errors: [{ code: 'unknown', field: 'city' }],
                },
                status: 400,
              });
            return {
              activeDrivers: 0,
              cities: CITIES,
              garagesApprovedThisMonth: 0,
              garagesListed: 0,
              garagesWaiting: 5,
              ...(city && { cityGaragesWaiting: CITY_WAITING[city] }),
            };
          },
        },
      },
    ],
  });
  const harness = await RouterTestingHarness.create();
  await harness.navigateByUrl(url);
  await settleAdmin(harness);
  return {
    asked,
    element: harness.fixture.nativeElement as HTMLElement,
    harness,
  };
}

export async function settleAdmin(harness: RouterTestingHarness) {
  for (let i = 0; i < 4; i++) {
    harness.detectChanges();
    await harness.fixture.whenStable();
    await new Promise((resolve) => setTimeout(resolve));
  }
  harness.detectChanges();
}

export const adminLine = (element: HTMLElement) =>
  element
    .querySelector('.admin-line')
    ?.textContent?.replace(/\s+/g, ' ')
    .trim();
export const garagesChip = (element: HTMLElement) =>
  element
    .querySelector('aside nav a[href="/app/admin/garages"] .chip')
    ?.textContent?.trim();
export const address = () => TestBed.inject(Router).url;
