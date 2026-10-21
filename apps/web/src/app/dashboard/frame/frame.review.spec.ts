import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import type { LiveMessage } from '@motor-fix/contracts';
import {
  GarageRequestsService,
  type MeDto,
  NotificationsService,
} from '@motor-fix/data-access';
import { Overlays } from '@motor-fix/overlays';
import { NEVER, Subject } from 'rxjs';

import { Frame } from './frame';
import { Live } from '../live';
import { ReviewTask } from '../review-task/review-task';
import { Session } from '../session';
import { dashboardRoutes } from '../views';

const JOB = '6c1f0a52-3b7e-4d1a-9f0e-2a4b5c6d7e8f';

const me = (role: string, capabilities: string[]) =>
  ({
    capabilities,
    email: 'andrei@example.ro',
    emailConfirmed: true,
    garageAccess: [],
    garageId: null,
    id: 'account-1',
    landing: `/app/${role}`,
    language: 'ro',
    name: 'Andrei Marin',
    role,
    roles: [role],
  }) as unknown as MeDto;

let closeTask: (result: unknown) => void;

async function render(url: string, role = 'driver') {
  Element.prototype.scrollIntoView = jest.fn();
  const overlays = {
    open: jest.fn(
      () =>
        new Promise<unknown>((resolve) => {
          closeTask = resolve;
        }),
    ),
  };
  const account = signal<MeDto | null>(
    me(role, role === 'driver' ? ['driver.reviews'] : ['garage.own_jobs']),
  );
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
          current: account,
          ended: new Subject<void>(),
          reload: jest.fn(async () => undefined),
          shown: account,
          token: () => 'access',
        },
      },
      {
        provide: Live,
        useValue: {
          close: jest.fn(),
          events: new Subject<LiveMessage>(),
          offline: signal(false),
          on: () => NEVER,
          open: jest.fn(),
          resync: new Subject<void>(),
          state: signal('open'),
        },
      },
      {
        provide: GarageRequestsService,
        useValue: {
          garageRequestsControllerList: async () => ({
            items: [],
            nextCursor: null,
            total: 0,
          }),
        },
      },
      {
        provide: NotificationsService,
        useValue: { bellControllerUnreadCount: async () => ({ count: 0 }) },
      },
      { provide: Overlays, useValue: overlays },
    ],
  });
  const harness = await RouterTestingHarness.create();
  await harness.navigateByUrl(url);
  await settle(harness);
  return { harness, overlays, router: TestBed.inject(Router) };
}

async function settle(harness: RouterTestingHarness) {
  for (let i = 0; i < 4; i++) {
    harness.detectChanges();
    await new Promise((resolve) => setTimeout(resolve));
  }
}

afterEach(() => TestBed.resetTestingModule());

// @traces 022-review-drawer-FR-001 022-review-drawer-FR-009
describe('the review drawer on the driver dashboard', () => {
  it('opens for the job the address names, as a drawer', async () => {
    const { overlays } = await render(`/app/driver/reviews?review=${JOB}`);

    expect(overlays.open).toHaveBeenCalledTimes(1);
    const [source, options] = overlays.open.mock.calls[0] as unknown as [
      () => Promise<unknown>,
      object,
    ];
    expect(options).toEqual({
      confirmDiscard: false,
      data: { jobId: JOB },
      shape: 'drawer',
      title: 'driver.review.title',
    });
    expect(await source()).toBe(ReviewTask);
  });

  it('opens on another driver view too', async () => {
    const { overlays } = await render(`/app/driver?tab=account&review=${JOB}`);

    expect(overlays.open).toHaveBeenCalledTimes(1);
  });

  it('opens nothing without the parameter', async () => {
    const { overlays } = await render('/app/driver/reviews');

    expect(overlays.open).not.toHaveBeenCalled();
  });

  it('opens nothing on the garage dashboard', async () => {
    const { overlays } = await render(`/app/garage?review=${JOB}`, 'garage');

    expect(overlays.open).not.toHaveBeenCalled();
  });

  it('drops the parameter when closed, replacing the address', async () => {
    const { harness, router } = await render(
      `/app/driver/reviews?review=${JOB}`,
    );

    closeTask('cancelled');
    await settle(harness);

    expect(router.url).toBe('/app/driver/reviews');
    expect(router.lastSuccessfulNavigation()?.extras.replaceUrl).toBe(true);
  });

  it('keeps the other parameters when closed after publishing', async () => {
    const { harness, router } = await render(
      `/app/driver?tab=account&review=${JOB}`,
    );

    closeTask({ id: 'review-1' });
    await settle(harness);

    expect(router.url).toBe('/app/driver?tab=account');
  });

  it('leaves the address alone when the parameter is already gone', async () => {
    const { harness, overlays, router } = await render(
      `/app/driver/reviews?review=${JOB}`,
    );

    await router.navigateByUrl('/app/driver');
    await settle(harness);
    const before = router.lastSuccessfulNavigation();
    closeTask('cancelled');
    await settle(harness);

    expect(router.url).toBe('/app/driver');
    expect(router.lastSuccessfulNavigation()).toBe(before);
    expect(overlays.open).toHaveBeenCalledTimes(1);
  });

  it('opens the task once for the same job', async () => {
    const { harness, overlays, router } = await render(
      `/app/driver/reviews?review=${JOB}`,
    );

    await router.navigateByUrl(`/app/driver/reviews?review=${JOB}&x=1`);
    await settle(harness);

    expect(overlays.open).toHaveBeenCalledTimes(1);
  });

  it('opens the task with no job for an id that is not a UUID', async () => {
    const { overlays } = await render('/app/driver/reviews?review=abc');

    expect(overlays.open).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({ data: { jobId: undefined } }),
    );
  });
});
