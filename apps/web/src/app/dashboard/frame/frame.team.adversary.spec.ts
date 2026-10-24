import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import type { LiveMessage } from '@motor-fix/contracts';
import type { MeDto } from '@motor-fix/data-access';
import { Overlays } from '@motor-fix/overlays';
import { Subject } from 'rxjs';

import { Frame } from './frame';
import { Live } from '../live';
import { Session } from '../session';
import { dashboardRoutes } from '../views';

const OWNER = [
  'garage.requests',
  'garage.schedule',
  'garage.team',
  'garage.prices',
  'garage.feature_switches',
];

const owner = (features: Record<string, boolean>) =>
  ({
    capabilities: OWNER,
    email: null,
    garageAccess: [
      {
        features,
        garageId: 'garage-1',
        name: 'Atelier Test',
        permissions: {
          canAnswerQuotes: true,
          canMoveBookings: true,
          canRecordFinalPrice: true,
        },
        role: 'owner',
        status: 'approved',
      },
    ],
    garageId: 'garage-1',
    id: 'account-1',
    landing: '/app/garage',
    language: 'ro',
    name: 'Ioana Pop',
    role: 'garage',
    roles: ['garage'],
  }) as unknown as MeDto;

async function render(url: string) {
  Element.prototype.scrollIntoView = jest.fn();
  const events = new Subject<LiveMessage>();
  const current = signal<MeDto | null>(owner({}));
  const reload = jest.fn(async () => undefined);
  TestBed.configureTestingModule({
    providers: [
      provideRouter([
        {
          children: dashboardRoutes('garage'),
          component: Frame,
          path: 'app/garage',
        },
      ]),
      {
        provide: Session,
        useValue: {
          current,
          ended: new Subject<void>(),
          reload,
          shown: current,
          signOut: jest.fn(),
          token: () => 'access',
        },
      },
      {
        provide: Live,
        useValue: {
          close: jest.fn(),
          events,
          offline: signal(false),
          on: () => new Subject<LiveMessage>(),
          open: jest.fn(),
          resync: new Subject<void>(),
          state: signal('open'),
        },
      },
      { provide: Overlays, useValue: { open: jest.fn() } },
    ],
  });
  const harness = await RouterTestingHarness.create();
  await harness.navigateByUrl(url);
  harness.detectChanges();
  return { current, events, harness, reload };
}

const settle = async (harness: RouterTestingHarness) => {
  harness.detectChanges();
  await harness.fixture.whenStable();
  harness.detectChanges();
};

const event = (kind: string, id = 'garage-1'): LiveMessage =>
  ({ at: '2026-10-24T10:00:00.000Z', id, kind }) as LiveMessage;

const labels = (harness: RouterTestingHarness) =>
  [...(harness.routeNativeElement?.ownerDocument.querySelectorAll('a') ?? [])]
    .map((a) => a.getAttribute('href'))
    .filter(Boolean);

describe('the frame under a stream of team events', () => {
  afterEach(() => TestBed.resetTestingModule());

  // @traces 531-FR-002
  it('reads the account once per mechanic.updated event in a burst', async () => {
    const { events, reload } = await render('/app/garage');
    reload.mockClear();

    for (let i = 0; i < 5; i++) events.next(event('mechanic.updated'));

    expect(reload).toHaveBeenCalledTimes(5);
  });

  // @traces 531-FR-002
  it('reads the account once for each of the two kinds', async () => {
    const { events, reload } = await render('/app/garage');
    reload.mockClear();

    events.next(event('mechanic.updated'));
    events.next(event('garage.features_changed'));

    expect(reload).toHaveBeenCalledTimes(2);
  });

  // @traces 531-FR-002
  it.each([
    'mechanic.update',
    'Mechanic.Updated',
    'mechanic.updated ',
    'mechanic',
    '',
  ])(
    'does not read the account again for the near-miss kind %j',
    async (kind) => {
      const { events, reload } = await render('/app/garage');
      reload.mockClear();

      events.next(event(kind));

      expect(reload).not.toHaveBeenCalled();
    },
  );

  // @traces 531-FR-002
  it('leaves Mecanici when a mechanic.updated re-read has the team off', async () => {
    const { current, events, harness, reload } =
      await render('/app/garage/team');
    reload.mockImplementation(async () => {
      current.set(owner({ team_mechanics: false }));
    });

    events.next(event('mechanic.updated'));
    await settle(harness);

    expect(TestBed.inject(Router).url).toBe('/app/garage');
  });

  // @traces 531-FR-002
  it('leaves Programări when a mechanic.updated re-read has day sheets off', async () => {
    const { current, events, harness, reload } = await render(
      '/app/garage/schedule',
    );
    reload.mockImplementation(async () => {
      current.set(owner({ day_sheets: false }));
    });

    events.next(event('mechanic.updated'));
    await settle(harness);

    expect(TestBed.inject(Router).url).toBe('/app/garage');
  });

  // @traces 531-FR-002
  it('keeps a view that still has its feature after mechanic.updated', async () => {
    const { events, harness } = await render('/app/garage/schedule');

    events.next(event('mechanic.updated'));
    await settle(harness);

    expect(TestBed.inject(Router).url).toBe('/app/garage/schedule');
  });

  // @traces 531-FR-002
  it('takes the schedule out of the menu once the re-read has day sheets off and back after it is on', async () => {
    const { current, events, harness, reload } = await render('/app/garage');
    const has = () => labels(harness).some((h) => h?.endsWith('/schedule'));
    expect(has()).toBe(true);

    reload.mockImplementation(async () => {
      current.set(owner({ day_sheets: false }));
    });
    events.next(event('mechanic.updated'));
    await settle(harness);
    expect(has()).toBe(false);

    reload.mockImplementation(async () => {
      current.set(owner({ day_sheets: true }));
    });
    events.next(event('mechanic.updated'));
    await settle(harness);
    expect(has()).toBe(true);
  });

  // @traces 531-FR-002
  it('raises no unhandled rejection when the re-read fails, and re-reads on the next event', async () => {
    const stray: unknown[] = [];
    const listeners = process.listeners('unhandledRejection');
    process.removeAllListeners('unhandledRejection');
    process.on('unhandledRejection', (e) => stray.push(e));
    try {
      const { events, harness, reload } = await render('/app/garage');
      reload.mockClear();
      // A failed read of the account: Session.reload catches the /me error
      // and resolves with the account as it was, never rejecting.
      reload.mockImplementationOnce(async () => undefined);

      events.next(event('mechanic.updated'));
      await settle(harness);
      await new Promise((resolve) => setTimeout(resolve, 10));
      events.next(event('mechanic.updated'));

      expect(stray).toEqual([]);
      expect(reload).toHaveBeenCalledTimes(2);
    } finally {
      process.removeAllListeners('unhandledRejection');
      for (const l of listeners) process.on('unhandledRejection', l);
    }
  });

  // @traces 531-FR-002
  it('stops re-reading once the frame is destroyed', async () => {
    const { events, harness, reload } = await render('/app/garage');
    reload.mockClear();

    harness.fixture.destroy();
    events.next(event('mechanic.updated'));

    expect(reload).not.toHaveBeenCalled();
  });
});
