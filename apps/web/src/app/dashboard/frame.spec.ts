import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import type { LiveMessage } from '@motor-fix/contracts';
import { type MeDto, MeService } from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';
import { toast } from '@motor-fix/ui-cockpit';
import { Subject } from 'rxjs';

import { Frame } from './frame';
import { Live } from './live';
import { Session } from './session';
import { dashboardRoutes } from './views';

jest.mock('@motor-fix/ui-cockpit', () => ({
  ...jest.requireActual('@motor-fix/ui-cockpit'),
  toast: jest.fn(),
}));

let signOut: jest.Mock;
let reload: jest.Mock;
let live: { close: jest.Mock; events: Subject<LiveMessage>; open: jest.Mock };

const me = (role: string, landing: string, capabilities: string[]) =>
  ({
    capabilities,
    email: null,
    garageId: null,
    id: 'account-1',
    landing,
    language: 'ro',
    name: 'Ioana Pop',
    role,
    roles: [role],
  }) as unknown as MeDto;

async function render(
  role: string,
  landing: string,
  capabilities: string[],
  url = landing,
) {
  Element.prototype.scrollIntoView = jest.fn();
  signOut = jest.fn(async () => current.set(null));
  reload = jest.fn(async () => undefined);
  live = { close: jest.fn(), events: new Subject(), open: jest.fn() };
  const current = signal<MeDto | null>(me(role, landing, capabilities));
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
        useValue: { current, ended: new Subject<void>(), reload, signOut },
      },
      { provide: Live, useValue: live },
      { provide: MeService, useValue: {} },
    ],
  });
  const harness = await RouterTestingHarness.create();
  await harness.navigateByUrl(url);
  harness.detectChanges();
  const element = harness.fixture.nativeElement as HTMLElement;
  return { current, element, fixture: harness.fixture, harness };
}

const menuLinks = (element: HTMLElement) => [
  ...element.querySelectorAll<HTMLAnchorElement>('aside nav a'),
];
const menu = (element: HTMLElement) =>
  menuLinks(element).map((a) => a.textContent?.trim());
const bar = (element: HTMLElement) => [
  ...element.querySelectorAll<HTMLAnchorElement>('mf-dashboard-tab-bar nav a'),
];
const title = (element: HTMLElement) =>
  element.querySelector('h1')?.textContent?.trim();
const url = () => TestBed.inject(Router).url;
const settle = async (harness: RouterTestingHarness) => {
  harness.detectChanges();
  await harness.fixture.whenStable();
  harness.detectChanges();
};

const OWNER = [
  'garage.requests',
  'garage.schedule',
  'garage.final_price',
  'garage.own_jobs',
  'garage.reviews',
  'garage.team',
  'garage.prices',
  'garage.profile',
  'garage.feature_switches',
];

describe('Frame', () => {
  it('shows the full garage menu to an owner', async () => {
    const { element } = await render('garage', '/app/garage', OWNER);

    expect(menu(element)).toEqual([
      'Panou',
      'Cereri de ofertă',
      'Programări',
      'Mecanici',
      'Prețuri',
      'Recenzii',
      'Profilul service‑ului',
    ]);
  });

  it('hides team, prices and the garage profile from a receptionist', async () => {
    const { element } = await render('receptionist', '/app/garage', [
      'garage.requests',
      'garage.schedule',
      'garage.final_price',
      'garage.own_jobs',
    ]);

    expect(menu(element)).toEqual(['Panou', 'Cereri de ofertă', 'Programări']);
  });

  it('shows a mechanic only their own jobs', async () => {
    const { element } = await render('mechanic', '/app/garage', [
      'garage.own_jobs',
    ]);

    expect(menu(element)).toEqual(['Panou']);
    expect(bar(element).map((a) => a.textContent?.trim())).toEqual(['Panou']);
  });

  it('shows the driver and admin menus', async () => {
    expect(
      menu(
        (
          await render('driver', '/app/driver', [
            'driver.requests',
            'driver.cars',
            'driver.reviews',
            'driver.saved_garages',
            'driver.settings',
          ])
        ).element,
      ),
    ).toEqual([
      'Panou',
      'Cererile mele',
      'Mașinile mele',
      'Recenziile mele',
      'Service‑uri salvate',
      'Setări',
    ]);
    TestBed.resetTestingModule();
    expect(
      menu(
        (
          await render('admin', '/app/admin', [
            'admin.garages',
            'admin.users',
            'admin.reviews',
            'admin.catalogue',
            'admin.settings',
          ])
        ).element,
      ),
    ).toEqual([
      'Panou',
      'Service‑uri',
      'Utilizatori',
      'Recenzii raportate',
      'Mărci și lucrări',
      'Setări',
    ]);
  });

  it('gives the bar the same views as the menu, in the same order, with short labels', async () => {
    const { element } = await render('garage', '/app/garage', OWNER);

    expect(bar(element).map((a) => a.getAttribute('href'))).toEqual(
      menuLinks(element).map((a) => a.getAttribute('href')),
    );
    expect(bar(element).map((a) => a.textContent?.trim())).toEqual([
      'Panou',
      'Cereri',
      'Program',
      'Mecanici',
      'Prețuri',
      'Recenzii',
      'Profil',
    ]);
    expect(
      element
        .querySelector('mf-dashboard-tab-bar nav')
        ?.getAttribute('aria-label'),
    ).toBe('Panou service');
  });

  it('links each menu entry to its view and marks the open one current', async () => {
    const { element } = await render(
      'driver',
      '/app/driver',
      ['driver.requests', 'driver.cars'],
      '/app/driver/cars',
    );

    expect(menuLinks(element).map((a) => a.getAttribute('href'))).toEqual([
      '/app/driver',
      '/app/driver/requests',
      '/app/driver/cars',
    ]);
    const currentEntries = menuLinks(element)
      .filter((a) => a.getAttribute('aria-current') === 'page')
      .map((a) => a.textContent?.trim());
    expect(currentEntries).toEqual(['Mașinile mele']);
    expect(title(element)).toBe('Mașinile mele');
  });

  it('puts the name and "Ieși din cont" after the menu, with no demo role buttons', async () => {
    const { element } = await render('driver', '/app/driver', []);
    const text = element.textContent ?? '';

    expect(text).toContain('Ioana Pop');
    expect(text).not.toMatch(/vezi ca/i);
    const nav = element.querySelector('aside nav');
    const signOutButton = [...element.querySelectorAll('button')].find(
      (b) => b.textContent?.trim() === 'Ieși din cont',
    );
    expect(signOutButton).toBeDefined();
    expect(nav?.compareDocumentPosition(signOutButton as Node)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });

  it('shows the signed-in name as written, marked not to be translated, in both languages', async () => {
    const { element, harness } = await render('driver', '/app/driver', []);
    const name = () => element.querySelector('.account [translate="no"]');

    expect(name()?.textContent?.trim()).toBe('Ioana Pop');
    await TestBed.inject(I18n).use('en');
    await settle(harness);
    expect(name()?.textContent?.trim()).toBe('Ioana Pop');
  });

  it('shows the open view as the title over a plain empty state', async () => {
    const { element, harness } = await render('driver', '/app/driver', [
      'driver.cars',
    ]);

    expect(title(element)).toBe('Panou');
    expect(element.querySelector('main')?.textContent).toContain(
      'Nimic aici încă.',
    );
    await harness.navigateByUrl('/app/driver/cars');
    await settle(harness);
    expect(title(element)).toBe('Mașinile mele');
    expect(element.querySelector('main')?.textContent).toContain(
      'Nimic aici încă.',
    );
  });

  it('leaves a view the session no longer allows for the dashboard view', async () => {
    const { current, harness } = await render(
      'garage',
      '/app/garage',
      OWNER,
      '/app/garage/team',
    );
    expect(url()).toBe('/app/garage/team');

    current.set(
      me('receptionist', '/app/garage', ['garage.requests', 'garage.schedule']),
    );
    await settle(harness);

    expect(url()).toBe('/app/garage');
  });

  it('follows a role change: the menu and the bar show the new role’s views', async () => {
    const { current, element, harness } = await render(
      'garage',
      '/app/garage',
      OWNER,
    );

    current.set(me('driver', '/app/driver', ['driver.cars']));
    await settle(harness);

    expect(url()).toBe('/app/driver');
    expect(menu(element)).toEqual(['Panou', 'Mașinile mele']);
    expect(bar(element).map((a) => a.textContent?.trim())).toEqual([
      'Panou',
      'Mașini',
    ]);
  });

  it('signs out on the server, then opens Home', async () => {
    const { current, element } = await render('driver', '/app/driver', []);
    const navigate = jest
      .spyOn(TestBed.inject(Router), 'navigateByUrl')
      .mockResolvedValue(true);

    [...element.querySelectorAll('button')]
      .find((b) => b.textContent?.trim() === 'Ieși din cont')
      ?.click();
    await new Promise((resolve) => setTimeout(resolve));

    expect(signOut).toHaveBeenCalledTimes(1);
    expect(current()).toBeNull();
    expect(navigate).toHaveBeenCalledWith('/');
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(signOut.mock.invocationCallOrder[0]).toBeLessThan(
      navigate.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it('has the language switch in its header', async () => {
    const { element } = await render('driver', '/app/driver', []);

    const group = element.querySelector('header [role="group"]');
    expect(group?.getAttribute('aria-label')).toBe('Limba');
  });

  it('turns the tag, the menu, the bar and the title English, keeping the open view', async () => {
    const { element, harness } = await render(
      'driver',
      '/app/driver',
      ['driver.requests', 'driver.cars'],
      '/app/driver/cars',
    );

    await TestBed.inject(I18n).use('en');
    await settle(harness);

    expect(element.querySelector('aside span')?.textContent?.trim()).toBe(
      'Driver',
    );
    expect(menu(element)).toEqual(['Dashboard', 'My requests', 'My cars']);
    expect(bar(element).map((a) => a.textContent?.trim())).toEqual([
      'Home',
      'Requests',
      'Cars',
    ]);
    expect(title(element)).toBe('My cars');
  });

  it('names the garage and admin areas and menus in English', async () => {
    const garage = await render('garage', '/app/garage', OWNER);
    await TestBed.inject(I18n).use('en');
    await settle(garage.harness);

    expect(
      garage.element.querySelector('aside span')?.textContent?.trim(),
    ).toBe('Garage');
    expect(menu(garage.element)).toEqual([
      'Dashboard',
      'Quote requests',
      'Bookings',
      'Mechanics',
      'Prices',
      'Reviews',
      'Garage profile',
    ]);

    TestBed.resetTestingModule();
    const admin = await render('admin', '/app/admin', [
      'admin.garages',
      'admin.users',
      'admin.reviews',
      'admin.catalogue',
      'admin.settings',
    ]);
    await TestBed.inject(I18n).use('en');
    await settle(admin.harness);

    expect(admin.element.querySelector('aside span')?.textContent?.trim()).toBe(
      'Admin',
    );
    expect(menu(admin.element)).toEqual([
      'Dashboard',
      'Garages',
      'Users',
      'Reported reviews',
      'Brands and jobs',
      'Settings',
    ]);
    expect(bar(admin.element).map((a) => a.textContent?.trim())).toEqual([
      'Home',
      'Garages',
      'Users',
      'Reported',
      'Brands',
      'Settings',
    ]);
  });

  it('opens the live connection when the dashboard starts and closes it when the dashboard goes', async () => {
    const { fixture } = await render('driver', '/app/driver', []);

    expect(live.open).toHaveBeenCalledTimes(1);
    expect(live.close).not.toHaveBeenCalled();

    fixture.destroy();
    expect(live.close).toHaveBeenCalledTimes(1);
  });

  it('keeps the same live connection while moving between views', async () => {
    const { harness } = await render('driver', '/app/driver', ['driver.cars']);

    await harness.navigateByUrl('/app/driver/cars');
    await settle(harness);

    expect(live.open).toHaveBeenCalledTimes(1);
    expect(live.close).not.toHaveBeenCalled();
  });

  it('closes the live connection at sign-out', async () => {
    const { element } = await render('driver', '/app/driver', []);
    jest.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);

    [...element.querySelectorAll('button')]
      .find((b) => b.textContent?.trim() === 'Ieși din cont')
      ?.click();
    await new Promise((resolve) => setTimeout(resolve));

    expect(live.close).toHaveBeenCalled();
    expect(live.close.mock.invocationCallOrder[0]).toBeLessThan(
      signOut.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it.each([
    ['driver', '/app/driver'],
    ['garage', '/app/garage'],
    ['receptionist', '/app/garage'],
    ['mechanic', '/app/garage'],
    ['admin', '/app/admin'],
  ])(
    'shows the test toast on a live test update for a %s',
    async (role, landing) => {
      (toast as unknown as jest.Mock).mockClear();
      const { element } = await render(role, landing, []);

      live.events.next({
        at: '2026-10-04T12:00:00.000Z',
        id: 'e-1',
        kind: 'hello',
      });
      expect(toast).not.toHaveBeenCalled();
      live.events.next({
        at: '2026-10-04T12:00:00.000Z',
        id: 'e-2',
        kind: 'live.test',
      });

      expect(toast).toHaveBeenCalledTimes(1);
      expect(toast).toHaveBeenCalledWith('Actualizare de test în direct');
      expect(element.querySelector('hlm-toaster')).not.toBeNull();
      TestBed.resetTestingModule();
    },
  );

  it('shows the test toast in English', async () => {
    (toast as unknown as jest.Mock).mockClear();
    const { harness } = await render('driver', '/app/driver', []);
    await TestBed.inject(I18n).use('en');
    await settle(harness);

    live.events.next({
      at: '2026-10-04T12:00:00.000Z',
      id: 'e-2',
      kind: 'live.test',
    });

    expect(toast).toHaveBeenCalledWith('Live test update');
  });

  it('reads the account again when its e-mail is confirmed in another tab', async () => {
    await render('driver', '/app/driver', []);

    live.events.next({
      at: '2026-10-05T12:00:00.000Z',
      id: 'account-1',
      kind: 'account.email_confirmed',
    });

    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('asks an account with an unconfirmed e-mail to confirm it, on every dashboard', async () => {
    for (const [role, landing] of [
      ['driver', '/app/driver'],
      ['garage', '/app/garage'],
      ['admin', '/app/admin'],
    ] as const) {
      const { current, element, harness } = await render(role, landing, []);
      const me = current();
      current.set({
        ...(me as MeDto),
        email: 'ioana@example.test',
        emailConfirmed: false,
      } as MeDto);
      await settle(harness);

      expect(element.querySelector('mf-email-banner')?.textContent).toContain(
        'Confirmă‑ți adresa de e‑mail',
      );
      TestBed.resetTestingModule();
    }
  });
});
