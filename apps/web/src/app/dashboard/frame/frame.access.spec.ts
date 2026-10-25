import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import type { LiveMessage } from '@motor-fix/contracts';
import type { MeDto } from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';
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
  'garage.settings',
];
const MECHANIC = ['garage.own_jobs', 'garage.schedule', 'garage.audit_history'];

const account = (
  capabilities: string[],
  {
    features = {},
    role = 'garage',
  }: { features?: Record<string, boolean>; role?: string } = {},
) =>
  ({
    capabilities,
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
        role: role === 'garage' ? 'owner' : role,
        status: 'approved',
      },
    ],
    garageId: 'garage-1',
    id: 'account-1',
    landing: '/app/garage',
    language: 'ro',
    name: 'Ioana Pop',
    role,
    roles: ['garage', 'mechanic'],
  }) as unknown as MeDto;

async function render(url: string, first = account(OWNER)) {
  Element.prototype.scrollIntoView = jest.fn();
  const events = new Subject<LiveMessage>();
  const current = signal<MeDto | null>(first);
  const garageGone = signal(false);
  const reload = jest.fn(async (): Promise<void> => undefined);
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
          garageGone,
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
  await settle(harness);
  return { current, events, garageGone, harness, reload };
}

async function settle(harness: RouterTestingHarness) {
  for (let i = 0; i < 3; i++) {
    harness.detectChanges();
    await harness.fixture.whenStable();
  }
}

const message = (kind: string): LiveMessage =>
  ({ at: '2026-10-24T10:00:00.000Z', id: 'garage-1', kind }) as LiveMessage;

const SECTION = 'Nu mai ai acces la această secțiune.';
const text = (element: Element) =>
  (element.textContent ?? '').replace(/\s+/g, ' ').trim();
const notices = (element: HTMLElement, line: string) =>
  [...element.querySelectorAll('[role="status"]')].filter((e) =>
    text(e).includes(line),
  );
const url = () => TestBed.inject(Router).url;

// @traces 102-FR-015
describe('the frame when the view on screen is no longer allowed', () => {
  it.each([
    [
      'garage.features_changed',
      account(OWNER, { features: { team_mechanics: false } }),
    ],
    ['mechanic.updated', account(OWNER.filter((c) => c !== 'garage.team'))],
  ])(
    'opens Panou and says so once after %s takes the view away',
    async (kind, after) => {
      const { current, events, harness, reload } =
        await render('/app/garage/team');
      reload.mockImplementation(async () => current.set(after));

      events.next(message(kind));
      await settle(harness);

      expect(url()).toBe('/app/garage');
      expect(notices(harness.fixture.nativeElement, SECTION)).toHaveLength(1);
    },
  );

  it('says it in English too', async () => {
    const { current, events, harness, reload } =
      await render('/app/garage/team');
    await TestBed.inject(I18n).use('en');
    reload.mockImplementation(async () =>
      current.set(account(OWNER.filter((c) => c !== 'garage.team'))),
    );

    events.next(message('mechanic.updated'));
    await settle(harness);

    expect(
      notices(
        harness.fixture.nativeElement,
        'You no longer have access to this section.',
      ),
    ).toHaveLength(1);
  });

  it('says nothing for an address typed on first load that the account may not open', async () => {
    const { harness } = await render(
      '/app/garage/prices',
      account(MECHANIC, { role: 'mechanic' }),
    );

    expect(url()).toBe('/app/garage');
    expect(notices(harness.fixture.nativeElement, SECTION)).toHaveLength(0);
  });

  it('says nothing when a role switch leaves the view', async () => {
    const { current, harness } = await render('/app/garage/team');

    current.set(account(MECHANIC, { role: 'mechanic' }));
    await settle(harness);

    expect(url()).toBe('/app/garage');
    expect(notices(harness.fixture.nativeElement, SECTION)).toHaveLength(0);
  });

  it('clears the notice when another view opens', async () => {
    const { current, events, harness, reload } =
      await render('/app/garage/team');
    reload.mockImplementation(async () =>
      current.set(account(OWNER.filter((c) => c !== 'garage.team'))),
    );
    events.next(message('mechanic.updated'));
    await settle(harness);
    expect(notices(harness.fixture.nativeElement, SECTION)).toHaveLength(1);

    await harness.navigateByUrl('/app/garage/schedule');
    await settle(harness);

    expect(notices(harness.fixture.nativeElement, SECTION)).toHaveLength(0);
  });

  it('says nothing when a re-read leaves the view allowed', async () => {
    const { events, harness } = await render('/app/garage/team');

    events.next(message('garage.features_changed'));
    await settle(harness);

    expect(url()).toBe('/app/garage/team');
    expect(notices(harness.fixture.nativeElement, SECTION)).toHaveLength(0);
  });
});

// @traces 102-FR-016
describe('the frame when the garage is no longer held', () => {
  it('shows the lost-garage screen with a way home, and a menu with no view', async () => {
    const { garageGone, harness } = await render('/app/garage/schedule');

    garageGone.set(true);
    await settle(harness);

    const element = harness.fixture.nativeElement as HTMLElement;
    const main = element.querySelector('main') as HTMLElement;
    expect(text(main)).toContain('Nu mai ai acces la acest service');
    const home = main.querySelector('a');
    expect(text(home as Element)).toBe('Spre pagina principală');
    expect(home?.getAttribute('href')).toBe('/');
    expect(main.querySelector('router-outlet')).toBeNull();
    expect(element.querySelectorAll('aside nav a')).toHaveLength(0);
    expect(notices(element, SECTION)).toHaveLength(0);
  });

  it('says it in English too', async () => {
    const { garageGone, harness } = await render('/app/garage');
    await TestBed.inject(I18n).use('en');

    garageGone.set(true);
    await settle(harness);

    const main = (harness.fixture.nativeElement as HTMLElement).querySelector(
      'main',
    ) as HTMLElement;
    expect(text(main)).toContain('You no longer have access to this garage');
    expect(text(main.querySelector('a') as Element)).toBe('To the home page');
  });

  it('keeps the menu and the view while the garage is held', async () => {
    const { harness } = await render('/app/garage/schedule');

    const element = harness.fixture.nativeElement as HTMLElement;
    expect(element.querySelectorAll('aside nav a').length).toBeGreaterThan(1);
    expect(element.querySelector('main router-outlet')).not.toBeNull();
  });
});
