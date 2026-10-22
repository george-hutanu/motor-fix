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

const featuresChanged = (): LiveMessage =>
  ({
    at: '2026-10-22T10:00:00.000Z',
    id: 'garage-1',
    kind: 'garage.features_changed',
  }) as LiveMessage;

// @traces 398-FR-009
describe('the frame following the garage’s switches', () => {
  it('reads the account again when the garage’s features change', async () => {
    const { events, reload } = await render('/app/garage');
    reload.mockClear();

    events.next(featuresChanged());

    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('leaves Mecanici for the dashboard at once when the reread account has the team off', async () => {
    const { current, events, harness, reload } =
      await render('/app/garage/team');
    expect(TestBed.inject(Router).url).toBe('/app/garage/team');
    reload.mockImplementation(async () => {
      current.set(owner({ team_mechanics: false }));
    });

    events.next(featuresChanged());
    await settle(harness);

    expect(TestBed.inject(Router).url).toBe('/app/garage');
  });

  it('stays on Mecanici when the reread account still has the team on', async () => {
    const { events, harness } = await render('/app/garage/team');

    events.next(featuresChanged());
    await settle(harness);

    expect(TestBed.inject(Router).url).toBe('/app/garage/team');
  });
});
