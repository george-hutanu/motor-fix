import { Component, computed, signal } from '@angular/core';
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
import { I18n } from '@motor-fix/i18n';
import { Overlays } from '@motor-fix/overlays';
import { toast } from '@motor-fix/ui-cockpit';
import { filter, Subject } from 'rxjs';

import { Frame } from './frame';
import { Live } from '../live';
import { Session } from '../session';
import { dashboardRoutes } from '../views';

jest.mock('@motor-fix/ui-cockpit', () => ({
  ...jest.requireActual('@motor-fix/ui-cockpit'),
  toast: jest.fn(),
}));

let signOut: jest.Mock;
let reload: jest.Mock;
let overview: jest.Mock;
let waiting = async (): Promise<{ garagesWaiting: number }> => ({
  garagesWaiting: 0,
});
let live: {
  close: jest.Mock;
  events: Subject<LiveMessage>;
  on: (kinds: readonly EventKind[]) => ReturnType<Subject<LiveMessage>['pipe']>;
  offline: ReturnType<typeof signal<boolean>>;
  open: jest.Mock;
  resync: Subject<void>;
};

const me = (
  role: string,
  landing: string,
  capabilities: string[],
  extra: Partial<MeDto> = {},
) =>
  ({
    capabilities,
    email: null,
    garageAccess: [],
    garageId: null,
    id: 'account-1',
    landing,
    language: 'ro',
    name: 'Ioana Pop',
    role,
    roles: [role],
    ...extra,
  }) as unknown as MeDto;

async function render(
  role: string,
  landing: string,
  capabilities: string[],
  url = landing,
  extra: Partial<MeDto> = {},
) {
  Element.prototype.scrollIntoView = jest.fn();
  signOut = jest.fn(async () => current.set(null));
  reload = jest.fn(async () => undefined);
  const events = new Subject<LiveMessage>();
  live = {
    close: jest.fn(),
    events,
    offline: signal(false),
    on: (kinds) =>
      events.pipe(filter((m) => (kinds as readonly string[]).includes(m.kind))),
    open: jest.fn(),
    resync: new Subject(),
  };
  overview = jest.fn(() => waiting());
  const current = signal<MeDto | null>(me(role, landing, capabilities, extra));
  // The account Session keeps on screen behind the gate dialog.
  const kept = signal<MeDto | null>(null);
  const shown = computed(() => current() ?? kept());
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
          current,
          ended: new Subject<void>(),
          reload,
          shown,
          signOut,
        },
      },
      { provide: Live, useValue: live },
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
        useValue: { adminOverviewControllerOverview: overview },
      },
    ],
  });
  const harness = await RouterTestingHarness.create();
  await harness.navigateByUrl(url);
  harness.detectChanges();
  const element = harness.fixture.nativeElement as HTMLElement;
  return { current, element, fixture: harness.fixture, harness, kept };
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

const testUpdate = (at: string): LiveMessage => ({
  at,
  id: 'e-2',
  kind: 'live.test',
});
const statusLine = (element: HTMLElement) =>
  element.querySelector('.live-status[role="status"]');

// A small action with a field, open on the dashboard.
@Component({ template: `<input aria-label="Notă" />` })
class Note {}

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
  'garage.audit_history',
];

// The owner's membership of Atelier Test, matched on the session's garage.
const atelier = (
  features: Record<string, boolean> = {},
  name = 'Atelier Test',
): Partial<MeDto> =>
  ({
    garageAccess: [
      {
        features,
        garageId: 'garage-1',
        name,
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
  }) as unknown as Partial<MeDto>;

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
      'Setări',
      'Istoric modificări',
    ]);
  });

  it('keeps the name and the whole menu behind the gate dialog, and stays on the view', async () => {
    const { current, element, harness, kept } = await render(
      'garage',
      '/app/garage',
      OWNER,
      '/app/garage/team',
    );
    const name = () =>
      element.querySelector('.account [translate="no"]')?.textContent?.trim();
    const before = menu(element);

    // A failed renewal forgot the session; the gate keeps the account shown.
    kept.set(current());
    current.set(null);
    await settle(harness);

    expect(name()).toBe('Ioana Pop');
    expect(menu(element)).toEqual(before);
    expect(menu(element)).toHaveLength(9);
    expect(title(element)).toBe('Mecanici');
    expect(url()).toBe('/app/garage/team');

    // The gate closed without a sign-in: nothing is kept.
    kept.set(null);
    await settle(harness);
    expect(name()).toBe('');
  });

  it('hides team, prices and the garage profile from a receptionist', async () => {
    const { element } = await render('receptionist', '/app/garage', [
      'garage.requests',
      'garage.schedule',
      'garage.final_price',
      'garage.own_jobs',
    ]);

    expect(menu(element)).toEqual([
      'Panou',
      'Cereri de ofertă',
      'Programări',
      'Setări',
    ]);
  });

  // @traces 198-FR-011
  it('shows a mechanic their own jobs and the settings', async () => {
    const { element } = await render('mechanic', '/app/garage', [
      'garage.own_jobs',
    ]);

    expect(menu(element)).toEqual(['Panou', 'Setări']);
    expect(bar(element).map((a) => a.textContent?.trim())).toEqual([
      'Panou',
      'Setări',
    ]);
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
    ).toEqual(['Panou', 'Service‑uri', 'Setări']);
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
      'Setări',
      'Istoric',
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

    expect(title(element)).toBe('Panoul tău');
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
      'DRIVER ACCOUNT',
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
    ).toBe('GARAGE ACCOUNT');
    expect(menu(garage.element)).toEqual([
      'Dashboard',
      'Quote requests',
      'Schedule',
      'Mechanics',
      'Prices',
      'Reviews',
      'Garage profile',
      'Settings',
      'Change history',
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
    expect(menu(admin.element)).toEqual(['Dashboard', 'Garages', 'Settings']);
    expect(bar(admin.element).map((a) => a.textContent?.trim())).toEqual([
      'Dashboard',
      'Garages',
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
    'changes the status line in place on a live test update, with no toast, for a %s',
    async (role, landing) => {
      (toast as unknown as jest.Mock).mockClear();
      const { element, harness } = await render(role, landing, []);

      live.events.next({
        at: '2026-10-04T12:00:00.000Z',
        id: 'e-1',
        kind: 'hello',
      });
      await settle(harness);
      // The region exists, empty, before the first update, so that the update is announced.
      const line = statusLine(element);
      expect(line).not.toBeNull();
      expect(line?.textContent?.trim()).toBe('');
      live.events.next(testUpdate('2026-10-04T12:00:00.000Z'));
      await settle(harness);
      expect(line?.textContent?.trim()).toBe(
        'Actualizare de test în direct · 15:00',
      );

      live.events.next(testUpdate('2026-10-04T12:05:00.000Z'));
      await settle(harness);

      expect(statusLine(element)).toBe(line);
      expect(line?.textContent?.trim()).toBe(
        'Actualizare de test în direct · 15:05',
      );
      expect(toast).not.toHaveBeenCalled();
      TestBed.resetTestingModule();
    },
  );

  it('shows the test update in English', async () => {
    const { element, harness } = await render('driver', '/app/driver', []);
    await TestBed.inject(I18n).use('en');
    await settle(harness);

    live.events.next(testUpdate('2026-10-04T12:00:00.000Z'));
    await settle(harness);

    expect(statusLine(element)?.textContent?.trim()).toBe(
      'Live test update · 15:00',
    );
  });

  it('leaves an open dialog, the text typed in it, the focus and the address as they were', async () => {
    const { element, harness } = await render('driver', '/app/driver', []);
    void TestBed.inject(Overlays).open(Note, {
      shape: 'dialog',
      title: 'shell.signOutEverywhere.title',
    });
    await settle(harness);
    const note = () =>
      document.querySelector<HTMLInputElement>('input[aria-label="Notă"]');
    const input = note();
    if (!input) throw new Error('the dialog did not open');
    input.focus();
    input.value = 'Zgomot la frânare';
    input.dispatchEvent(new Event('input'));

    live.events.next(testUpdate('2026-10-04T12:00:00.000Z'));
    await settle(harness);

    expect(statusLine(element)?.textContent?.trim()).not.toBe('');
    expect(note()).toBe(input);
    expect(input.value).toBe('Zgomot la frânare');
    expect(document.activeElement).toBe(input);
    expect(url()).toBe('/app/driver');
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

const ADMIN = [
  'admin.garages',
  'admin.users',
  'admin.reviews',
  'admin.catalogue',
  'admin.settings',
];
const line = (element: HTMLElement) =>
  element
    .querySelector('.admin-line')
    ?.textContent?.replace(/\s+/g, ' ')
    .trim();
const garagesEntry = (element: HTMLElement) =>
  menuLinks(element).find(
    (a) => a.getAttribute('href') === '/app/admin/garages',
  );
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function admin(count: number | Error) {
  waiting = async () => {
    if (count instanceof Error) throw count;
    return { garagesWaiting: count };
  };
  const rendered = await render('admin', '/app/admin', ADMIN);
  await settle(rendered.harness);
  return rendered;
}

describe('the admin header', () => {
  afterEach(() => {
    waiting = async () => ({ garagesWaiting: 0 });
  });

  it.each([
    [0, 'MotorFix · București · niciun service nu așteaptă verificarea'],
    [1, 'MotorFix · București · 1 service așteaptă verificarea'],
    [4, 'MotorFix · București · 4 service‑uri așteaptă verificarea'],
    [20, 'MotorFix · București · 20 de service‑uri așteaptă verificarea'],
    [101, 'MotorFix · București · 101 service‑uri așteaptă verificarea'],
  ])('reads %i waiting in Romanian', async (count, text) => {
    const { element } = await admin(count);

    expect(line(element)).toBe(text);
  });

  it.each([
    [0, 'MotorFix · Bucharest · no garage is waiting for verification'],
    [1, 'MotorFix · Bucharest · 1 garage is waiting for verification'],
    [5, 'MotorFix · Bucharest · 5 garages are waiting for verification'],
  ])('reads %i waiting in English', async (count, text) => {
    const { element, harness } = await admin(count);
    await TestBed.inject(I18n).use('en');
    await settle(harness);

    expect(line(element)).toBe(text);
  });

  it('carries the ADMINISTRATOR label in both languages', async () => {
    const { element, harness } = await admin(2);
    const label = () =>
      element.querySelector('header .admin-label')?.textContent?.trim();

    expect(label()).toBe('ADMINISTRATOR');
    await TestBed.inject(I18n).use('en');
    await settle(harness);
    expect(label()).toBe('ADMINISTRATOR');
  });

  it('puts the count on the garages entry, with the count in its name, and on no other', async () => {
    const { element } = await admin(4);

    expect(
      garagesEntry(element)?.querySelector('.chip')?.textContent?.trim(),
    ).toBe('4');
    expect(garagesEntry(element)?.getAttribute('aria-label')).toBe(
      'Service‑uri, 4 în așteptare',
    );
    expect(element.querySelectorAll('aside nav .chip')).toHaveLength(1);
    expect(element.querySelectorAll('mf-dashboard-tab-bar .chip')).toHaveLength(
      1,
    );
  });

  it('shows no count on the garages entry when none waits', async () => {
    const { element } = await admin(0);

    expect(garagesEntry(element)?.querySelector('.chip')).toBeNull();
    expect(garagesEntry(element)?.getAttribute('aria-label')).toBeNull();
    expect(element.querySelectorAll('.chip-skeleton')).toHaveLength(0);
  });

  it('shows a skeleton in place of the count while the first read runs', async () => {
    waiting = () => new Promise(() => undefined);
    const { element, harness } = await render('admin', '/app/admin', ADMIN);
    await settle(harness);

    expect(element.querySelector('.admin-line .skeleton')).not.toBeNull();
    expect(line(element)).toBe('MotorFix · București ·');
    expect(element.querySelectorAll('.chip')).toHaveLength(0);
    expect(element.querySelectorAll('aside nav .chip-skeleton')).toHaveLength(
      1,
    );
    expect(
      garagesEntry(element)?.querySelector('.chip-skeleton'),
    ).not.toBeNull();
    expect(
      element.querySelectorAll('mf-dashboard-tab-bar .chip-skeleton'),
    ).toHaveLength(1);
  });

  it('hides the count everywhere when the read fails, never showing 0', async () => {
    const { element } = await admin(new Error('offline'));

    expect(line(element)).toBe('MotorFix · București');
    expect(element.querySelector('.admin-line .skeleton')).toBeNull();
    expect(element.querySelectorAll('.chip')).toHaveLength(0);
    expect(element.querySelectorAll('.chip-skeleton')).toHaveLength(0);
  });

  it('moves the line and the count when a garage sends its file, without a reload', async () => {
    const { element, harness } = await admin(2);

    waiting = async () => ({ garagesWaiting: 3 });
    live.events.next({
      at: '2026-10-07T09:00:00.000Z',
      id: 'file-9',
      kind: 'verification.submitted',
    });
    await pause(400);
    await settle(harness);

    expect(line(element)).toBe(
      'MotorFix · București · 3 service‑uri așteaptă verificarea',
    );
    expect(
      garagesEntry(element)?.querySelector('.chip')?.textContent?.trim(),
    ).toBe('3');
  });

  it('turns the counted entry English with the language', async () => {
    const { element, harness } = await admin(4);
    await TestBed.inject(I18n).use('en');
    await settle(harness);

    expect(garagesEntry(element)?.getAttribute('aria-label')).toBe(
      'Garages, 4 waiting',
    );
  });

  it('shows no admin line on another dashboard and reads no overview there', async () => {
    const { element } = await render('garage', '/app/garage', OWNER);

    expect(element.querySelector('.admin-line')).toBeNull();
    expect(element.querySelector('.admin-label')).toBeNull();
    expect(overview).not.toHaveBeenCalled();
  });
});

const DRIVER = [
  'driver.requests',
  'driver.cars',
  'driver.reviews',
  'driver.saved_garages',
  'driver.settings',
];
const subtitle = (element: HTMLElement) =>
  element.querySelector('header .title .line')?.textContent?.trim();

// @traces 028-FR-002
describe('the driver header', () => {
  it.each([
    ['/app/driver', 'Panoul tău'],
    ['/app/driver/requests', 'Cererile mele'],
    ['/app/driver/cars', 'Mașinile mele'],
    ['/app/driver/reviews', 'Recenziile mele'],
    ['/app/driver/saved', 'Service‑uri salvate'],
    ['/app/driver/settings', 'Setări'],
  ])('titles %s "%s"', async (address, text) => {
    const { element } = await render('driver', '/app/driver', DRIVER, address);

    expect(title(element)).toBe(text);
    expect(element.querySelectorAll('h1')).toHaveLength(1);
  });

  it('shows the settings subtitle under the settings title only', async () => {
    const { element, harness } = await render(
      'driver',
      '/app/driver',
      DRIVER,
      '/app/driver/settings',
    );

    expect(subtitle(element)).toBe('Datele contului și notificările');
    await harness.navigateByUrl('/app/driver/cars');
    await settle(harness);
    expect(subtitle(element)).toBeUndefined();
  });

  it('turns the titles and the subtitle English', async () => {
    const { element, harness } = await render(
      'driver',
      '/app/driver',
      DRIVER,
      '/app/driver/settings',
    );

    await TestBed.inject(I18n).use('en');
    await settle(harness);
    expect(title(element)).toBe('Settings');
    expect(subtitle(element)).toBe('Account details and notifications');
    await harness.navigateByUrl('/app/driver');
    await settle(harness);
    expect(title(element)).toBe('Your dashboard');
  });

  it('opens the dashboard view, titled, at the unreleased assistant address', async () => {
    const { element } = await render(
      'driver',
      '/app/driver',
      DRIVER,
      '/app/driver/assistant',
    );

    expect(url()).toBe('/app/driver');
    expect(title(element)).toBe('Panoul tău');
    expect(menu(element)).not.toContain('Asistent AI');
    expect(bar(element).map((a) => a.textContent?.trim())).not.toContain('AI');
  });

  it('gives each garage view its own title and line', async () => {
    const { element } = await render(
      'garage',
      '/app/garage',
      OWNER,
      '/app/garage/team',
    );

    expect(title(element)).toBe('Mecanici');
    expect(subtitle(element)).toBe('Echipa ta și ce poate face fiecare');
  });
});

// @traces 028-FR-004
describe('the account block', () => {
  const initials = (element: HTMLElement) =>
    element.querySelector('.account .avatar');

  it('names the driver account in both languages', async () => {
    const { element, harness } = await render('driver', '/app/driver', []);
    const tag = () => element.querySelector('aside .eyebrow');

    expect(tag()?.textContent?.trim()).toBe('CONT ȘOFER');
    await TestBed.inject(I18n).use('en');
    await settle(harness);
    expect(tag()?.textContent?.trim()).toBe('DRIVER ACCOUNT');
  });

  it('names the garage account and leaves the admin line as it was', async () => {
    const garage = await render('garage', '/app/garage', OWNER);
    expect(
      garage.element.querySelector('aside .eyebrow')?.textContent?.trim(),
    ).toBe('CONT SERVICE');

    TestBed.resetTestingModule();
    const admin = await render('admin', '/app/admin', ['admin.garages']);
    expect(
      admin.element.querySelector('aside .eyebrow')?.textContent?.trim(),
    ).toBe('Admin');
  });

  it.each([
    ['driver', '/app/driver', [] as string[]],
    ['garage', '/app/garage', OWNER],
    ['admin', '/app/admin', ['admin.garages']],
  ])(
    'shows the initials beside the name on the %s dashboard, hidden from assistive technology',
    async (role, landing, capabilities) => {
      const { element } = await render(role, landing, capabilities);
      const letters = initials(element);

      expect(letters?.textContent?.trim()).toBe('IP');
      expect(letters?.getAttribute('aria-hidden')).toBe('true');
      const name = element.querySelector('.account [translate="no"]');
      expect(name?.textContent?.trim()).toBe('Ioana Pop');
      expect(letters?.compareDocumentPosition(name as Node)).toBe(
        Node.DOCUMENT_POSITION_FOLLOWING,
      );
    },
  );

  it('shows no initials for an empty name', async () => {
    const { current, element, harness } = await render(
      'driver',
      '/app/driver',
      [],
    );
    current.update((me) => (me ? { ...me, name: '   ' } : me));
    await settle(harness);

    expect(initials(element)).toBeNull();
  });
});

describe('the garage header', () => {
  const line = (element: HTMLElement) =>
    element.querySelector('header .line')?.textContent?.trim();
  const tag = (element: HTMLElement) =>
    element.querySelector('aside .eyebrow')?.textContent?.trim();

  // @traces 097-FR-006
  it('tags the menu CONT SERVICE and names the garage under Panou service', async () => {
    const { element, harness } = await render(
      'garage',
      '/app/garage',
      OWNER,
      '/app/garage',
      atelier(),
    );

    expect(tag(element)).toBe('CONT SERVICE');
    expect(title(element)).toBe('Panou service');
    expect(line(element)).toBe('Atelier Test');

    await TestBed.inject(I18n).use('en');
    await settle(harness);
    expect(tag(element)).toBe('GARAGE ACCOUNT');
    expect(title(element)).toBe('Garage dashboard');
    expect(line(element)).toBe('Atelier Test');
  });

  // @traces 097-FR-006
  it('shows no garage line with no membership, or when the session’s garage matches none', async () => {
    const none = await render('garage', '/app/garage', OWNER);
    expect(title(none.element)).toBe('Panou service');
    expect(line(none.element)).toBeUndefined();

    TestBed.resetTestingModule();
    const other = await render('garage', '/app/garage', OWNER, '/app/garage', {
      ...atelier(),
      garageId: 'another-garage',
    });
    expect(line(other.element)).toBeUndefined();
    expect(other.element.textContent).not.toContain('Atelier Test');
  });

  // @traces 097-FR-003
  it('gives each garage view its own title and subtitle, in both languages', async () => {
    const { element, harness } = await render(
      'garage',
      '/app/garage',
      OWNER,
      '/app/garage/prices',
      atelier(),
    );

    expect(title(element)).toBe('Prețuri');
    expect(line(element)).toBe(
      'Intervalele pe care le văd șoferii pe profilul tău',
    );
    await harness.navigateByUrl('/app/garage/history');
    await settle(harness);
    expect(title(element)).toBe('Istoric modificări');
    expect(line(element)).toBe('Cine a schimbat ce și când');

    await TestBed.inject(I18n).use('en');
    await settle(harness);
    expect(title(element)).toBe('Change history');
    expect(line(element)).toBe('Who changed what and when');
  });

  // @traces 097-FR-007
  it('leaves Mecanici out of the menu and the bar while the garage has mechanics switched off', async () => {
    const { element } = await render(
      'garage',
      '/app/garage',
      OWNER,
      '/app/garage',
      atelier({ team_mechanics: false }),
    );

    expect(menu(element)).not.toContain('Mecanici');
    expect(bar(element).map((a) => a.textContent?.trim())).not.toContain(
      'Mecanici',
    );
    expect(menu(element)).toContain('Prețuri');
  });

  // @traces 097-FR-007
  it('moves off Mecanici when the garage switches it off', async () => {
    const { current, harness } = await render(
      'garage',
      '/app/garage',
      OWNER,
      '/app/garage/team',
      atelier(),
    );
    expect(url()).toBe('/app/garage/team');

    current.set(
      me('garage', '/app/garage', OWNER, atelier({ team_mechanics: false })),
    );
    await settle(harness);

    expect(url()).toBe('/app/garage');
  });

  // @traces 097-FR-010
  it('shows a long garage name as written, marked not to be translated', async () => {
    const { element } = await render(
      'garage',
      '/app/garage',
      OWNER,
      '/app/garage',
      atelier({}, 'Service Auto Foarte Lung Pentru Ecranele Mici Din Centru'),
    );

    const line = element.querySelector('header .line');
    expect(line?.textContent?.trim()).toBe(
      'Service Auto Foarte Lung Pentru Ecranele Mici Din Centru',
    );
    expect(line?.getAttribute('translate')).toBe('no');
  });
});
