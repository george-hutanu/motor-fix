import { signal } from '@angular/core';
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
import { I18n } from '@motor-fix/i18n';
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
  const session = {
    current,
    ended: new Subject<void>(),
    revoked: jest.fn(() => current.set(null)),
    shown: current,
    signOut: jest.fn(async () => current.set(null)),
    signOutEverywhere: jest.fn(async () => current.set(null)),
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

const button = (element: HTMLElement, text: string) =>
  [...element.querySelectorAll<HTMLButtonElement>('.account button')].find(
    (b) => b.textContent?.trim() === text,
  );
const flush = () => new Promise((resolve) => setTimeout(resolve));
const EVERYWHERE = 'Ieși de pe toate dispozitivele';

describe('the dashboard account block', () => {
  it.each([
    ['driver', '/app/driver'],
    ['garage', '/app/garage'],
    ['receptionist', '/app/garage'],
    ['mechanic', '/app/garage'],
    ['admin', '/app/admin'],
  ])(
    'offers "Ieși de pe toate dispozitivele" under "Ieși din cont" for a %s',
    async (role, landing) => {
      const { element } = await render(role, landing);

      const here = button(element, 'Ieși din cont');
      const everywhere = button(element, EVERYWHERE);

      expect(here).toBeDefined();
      expect(everywhere).toBeDefined();
      expect(here?.compareDocumentPosition(everywhere as Node)).toBe(
        Node.DOCUMENT_POSITION_FOLLOWING,
      );
    },
  );

  it('names it in English', async () => {
    const { element, harness } = await render('driver', '/app/driver');
    await TestBed.inject(I18n).use('en');
    harness.detectChanges();

    expect(button(element, 'Sign out on all devices')).toBeDefined();
  });
});

describe('signing out on this device', () => {
  it('shows both sign-out buttons busy while it waits, and a second click signs out once', async () => {
    const { element, harness, navigate, session } = await render(
      'driver',
      '/app/driver',
    );
    let finish: () => void = () => undefined;
    session.signOut.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );

    button(element, 'Ieși din cont')?.click();
    await flush();
    harness.detectChanges();
    const here = button(element, 'Ieși din cont');
    const everywhere = button(element, EVERYWHERE);
    expect(here?.disabled).toBe(true);
    expect(here?.getAttribute('aria-busy')).toBe('true');
    expect(everywhere?.disabled).toBe(true);

    here?.click();
    finish();
    await flush();

    expect(session.signOut).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledTimes(1);
  });
});

describe('signing out on all devices', () => {
  it('asks first, in a dialog', async () => {
    const { element, overlays } = await render('driver', '/app/driver');

    button(element, EVERYWHERE)?.click();
    await flush();

    expect(overlays.open).toHaveBeenCalledWith(expect.anything(), {
      shape: 'dialog',
      title: 'shell.signOutEverywhere.title',
    });
  });

  it('closes the live connection, signs out everywhere and opens Home once confirmed', async () => {
    const { element, live, navigate, session } = await render(
      'garage',
      '/app/garage',
    );

    button(element, EVERYWHERE)?.click();
    await flush();

    expect(session.signOutEverywhere).toHaveBeenCalledTimes(1);
    expect(session.signOut).not.toHaveBeenCalled();
    expect(live.close.mock.invocationCallOrder[0]).toBeLessThan(
      session.signOutEverywhere.mock.invocationCallOrder[0] ?? 0,
    );
    expect(navigate).toHaveBeenLastCalledWith('/');
  });

  it.each([
    ['"Renunță"', false],
    ['closing the dialog', 'cancelled'],
  ])('changes nothing after %s', async (_, answer) => {
    const { element, live, navigate, session } = await render(
      'driver',
      '/app/driver',
      answer,
    );

    button(element, EVERYWHERE)?.click();
    await flush();

    expect(session.signOutEverywhere).not.toHaveBeenCalled();
    expect(live.close).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });
});

// @traces 127-FR-013
describe('a session ended elsewhere', () => {
  it('forgets the session and opens Home on a session.revoked live message, asking the server nothing', async () => {
    const { live, navigate, session } = await render('admin', '/app/admin');

    live.events.next({
      at: new Date().toISOString(),
      id: 'event-1',
      kind: 'session.revoked',
    });
    await flush();

    expect(live.close).toHaveBeenCalled();
    expect(session.revoked).toHaveBeenCalledTimes(1);
    expect(session.signOut).not.toHaveBeenCalled();
    expect(navigate).toHaveBeenLastCalledWith('/');
  });

  it('closes the live connection and opens Home when another tab signed out', async () => {
    const { live, navigate, session } = await render('driver', '/app/driver');

    session.ended.next();
    await flush();

    expect(live.close).toHaveBeenCalled();
    expect(session.signOut).not.toHaveBeenCalled();
    expect(navigate).toHaveBeenLastCalledWith('/');
  });
});
