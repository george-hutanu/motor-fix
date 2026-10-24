import { computed, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import type { LiveMessage } from '@motor-fix/contracts';
import {
  AdminService,
  GarageRequestsService,
  type MeDto,
  NotificationsService,
} from '@motor-fix/data-access';
import { Overlays } from '@motor-fix/overlays';
import { NEVER, Subject } from 'rxjs';

import { Frame } from './frame';
import { Live } from '../live';
import { Session } from '../session';
import { dashboardRoutes } from '../views';

const me = (role: string, landing: string) =>
  ({
    capabilities: [],
    email: null,
    garageAccess: [],
    garageId: null,
    id: 'account-1',
    landing,
    language: 'ro',
    name: 'Ioana Pop',
    role,
    roles: [role],
  }) as unknown as MeDto;

async function render(role: string, landing: string, answer: unknown = true) {
  Element.prototype.scrollIntoView = jest.fn();
  const current = signal<MeDto | null>(me(role, landing));
  // The account the sign-in gate keeps on screen while it is open.
  const kept = signal<MeDto | null>(null);
  const session = {
    current,
    deletingAccount: jest.fn(() => false),
    ended: new Subject<void>(),
    keepsThroughRevoke: jest.fn(() => false),
    kept,
    renew: jest.fn(async () => true),
    revoked: jest.fn(() => current.set(null)),
    shown: computed(() => current() ?? kept()),
    signOut: jest.fn(async () => current.set(null)),
    signOutEverywhere: jest.fn(async () => current.set(null)),
    token: () => 'access',
  };
  const live = {
    close: jest.fn(),
    events: new Subject<LiveMessage>(),
    offline: signal(false),
    on: () => NEVER,
    open: jest.fn(),
    resync: new Subject<void>(),
    state: signal('open'),
  };
  const overlays = { open: jest.fn(async () => answer) };
  TestBed.configureTestingModule({
    providers: [
      provideRouter(
        (['driver', 'garage', 'admin'] as const).map((area) => ({
          children: dashboardRoutes(area),
          component: Frame,
          path: `app/${area}`,
        })),
      ),
      { provide: Session, useValue: session },
      { provide: Live, useValue: live },
      {
        provide: AdminService,
        useValue: {
          adminOverviewControllerOverview: async () => ({ garagesWaiting: 0 }),
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
  await harness.navigateByUrl(landing);
  harness.detectChanges();
  const navigate = jest
    .spyOn(TestBed.inject(Router), 'navigateByUrl')
    .mockResolvedValue(true);
  const element = harness.fixture.nativeElement as HTMLElement;
  return { element, harness, live, navigate, overlays, session };
}

const flush = () => new Promise((resolve) => setTimeout(resolve));
const hrefs = (element: HTMLElement) =>
  [...element.querySelectorAll<HTMLAnchorElement>('a[href^="/app/"]')].map(
    (a) => a.getAttribute('href') ?? '',
  );

// @traces 532-FR-001
// @traces 532-FR-002
describe('a lost session, from every role', () => {
  it.each([
    ['driver', '/app/driver'],
    ['mechanic', '/app/garage'],
    ['receptionist', '/app/garage'],
    ['admin', '/app/admin'],
  ])('opens Home once for a lapsed %s', async (role, landing) => {
    const { harness, navigate, session } = await render(role, landing);

    session.current.set(null);
    harness.detectChanges();
    await flush();
    harness.detectChanges();
    await flush();

    expect(navigate.mock.calls.filter(([url]) => url === '/')).toHaveLength(1);
  });

  it('opens Home again for a second lapse after signing back in', async () => {
    const { harness, navigate, session } = await render(
      'garage',
      '/app/garage',
    );
    const garage = session.current();

    session.current.set(null);
    harness.detectChanges();
    await flush();
    session.current.set(garage);
    harness.detectChanges();
    await flush();
    navigate.mockClear();
    session.current.set(null);
    harness.detectChanges();
    await flush();

    expect(navigate).toHaveBeenCalledWith('/');
  });

  it('does not go Home when the gate closes with a sign-in as the same account', async () => {
    const { harness, navigate, session } = await render(
      'garage',
      '/app/garage',
    );
    const garage = session.current();

    session.kept.set(garage);
    session.current.set(null);
    harness.detectChanges();
    await flush();
    session.current.set(garage);
    session.kept.set(null);
    harness.detectChanges();
    await flush();

    expect(navigate).not.toHaveBeenCalled();
  });

  it('does not go Home when the gate closes with a sign-in as another role, and moves to that role’s landing', async () => {
    const { harness, navigate, session } = await render(
      'garage',
      '/app/garage',
    );

    session.kept.set(session.current());
    session.current.set(null);
    harness.detectChanges();
    await flush();
    session.current.set(me('driver', '/app/driver'));
    session.kept.set(null);
    harness.detectChanges();
    await flush();

    expect(navigate).not.toHaveBeenCalledWith('/');
    expect(navigate).toHaveBeenCalledWith('/app/driver');
  });

  it('keeps the screen through the whole time the gate is open, however long and however often it is read', async () => {
    const { element, harness, navigate, session } = await render(
      'garage',
      '/app/garage',
    );
    session.kept.set(session.current());
    session.current.set(null);

    for (let i = 0; i < 5; i++) {
      harness.detectChanges();
      await flush();
    }

    expect(navigate).not.toHaveBeenCalled();
    expect(hrefs(element).some((h) => h.startsWith('/app/garage'))).toBe(true);
  });
});
