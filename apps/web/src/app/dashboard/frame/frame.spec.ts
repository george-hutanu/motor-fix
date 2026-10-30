import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { Component, computed, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import type { EventKind, LiveMessage } from '@motor-fix/contracts';
import {
  AdminService,
  CarsService,
  type GarageRequestListDto,
  GarageRequestsService,
  GaragesService,
  type MeDto,
  MeService,
  NotificationsService,
} from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';
import { Overlays } from '@motor-fix/overlays';
import { toast } from '@motor-fix/ui-cockpit';
import { filter, Subject } from 'rxjs';

import { Frame } from './frame';
import { spoken } from '../../spoken.testing';
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
let waiting = async (): Promise<{
  garagesWaiting: number;
  reportsPending?: number;
}> => ({
  garagesWaiting: 0,
});
let requests = async (): Promise<GarageRequestListDto> => ({
  items: [],
  nextCursor: null,
  total: 0,
});
let requestReads: jest.Mock;
let live: {
  close: jest.Mock;
  events: Subject<LiveMessage>;
  on: (kinds: readonly EventKind[]) => ReturnType<Subject<LiveMessage>['pipe']>;
  offline: ReturnType<typeof signal<boolean>>;
  open: jest.Mock;
  resync: Subject<void>;
  state: ReturnType<typeof signal<string>>;
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
    state: signal('open'),
  };
  overview = jest.fn(() => waiting());
  requestReads = jest.fn(() => requests());
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
          garageGone: () => false,
          reload,
          shown,
          signOut,
          token: () => 'access',
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
      {
        provide: GarageRequestsService,
        useValue: { garageRequestsControllerList: requestReads },
      },
      {
        provide: GaragesService,
        useValue: {
          verificationStatusControllerRead: () => new Promise(() => undefined),
        },
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

// The same membership while its file waits for the admins.
const draftAtelier = (): Partial<MeDto> => {
  const base = atelier() as unknown as {
    garageAccess: Record<string, unknown>[];
  };
  return {
    ...base,
    garageAccess: base.garageAccess.map((access) => ({
      ...access,
      status: 'draft',
    })),
  } as unknown as Partial<MeDto>;
};

describe('Frame', () => {
  it('shows the full garage menu to an owner', async () => {
    const { element } = await render('garage', '/app/garage', OWNER);

    expect(menu(element)).toEqual([
      'Panou',
      'Cereri de ofertă',
      'Programări',
      'Lucrări',
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
    expect(menu(element)).toHaveLength(10);
    expect(title(element)).toBe('Mecanici');
    expect(url()).toBe('/app/garage/team');

    // The gate closed without a sign-in: nothing is kept, and Home opens.
    kept.set(null);
    await settle(harness);
    expect(url()).toBe('/');
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
      'Lucrări',
      'Setări',
    ]);
  });

  // @traces 198-FR-011
  // @traces 424-FR-012
  it('shows a mechanic their own jobs and the settings', async () => {
    const { element } = await render('mechanic', '/app/garage', [
      'garage.own_jobs',
    ]);

    expect(menu(element)).toEqual(['Panou', 'Lucrări', 'Setări']);
    expect(bar(element).map((a) => a.textContent?.trim())).toEqual([
      'Panou',
      'Lucrări',
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
    ).toEqual([
      'Panou',
      'Service‑uri',
      'Utilizatori',
      'Recenzii raportate',
      'Mărci și lucrări',
      'Lucrări propuse',
      'Jurnal de sistem',
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
      'Lucrări',
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

  it('shows the open view as the title over its body or a plain empty state', async () => {
    const { element, harness } = await render('driver', '/app/driver', [
      'driver.cars',
    ]);

    expect(title(element)).toBe('Panoul tău');
    expect(element.querySelector('main mf-driver-home')).not.toBeNull();
    await harness.navigateByUrl('/app/driver/cars');
    await settle(harness);
    expect(title(element)).toBe('Mașinile mele');
    // @traces 030-FR-009
    expect(element.querySelector('main')?.textContent).toContain(
      'Adaugă prima ta mașină. O folosim ca să‑ți arătăm service‑urile potrivite și să‑ți amintim de ITP.',
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
      'Jobs',
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
    expect(menu(admin.element)).toEqual([
      'Dashboard',
      'Garages',
      'Users',
      'Reported reviews',
      'Brands and jobs',
      'Proposed jobs',
      'System log',
      'Settings',
    ]);
    expect(bar(admin.element).map((a) => a.textContent?.trim())).toEqual([
      'Dashboard',
      'Garages',
      'Users',
      'Reported',
      'Brands',
      'Proposed',
      'Log',
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

  // @traces 049-FR-007 049-FR-012
  it('reads the account again when its garage is suspended, so the banner shows at once', async () => {
    await render('garage', '/app/garage', []);

    live.events.next({
      at: '2026-10-17T09:00:00.000Z',
      id: 'garage-1',
      kind: 'garage.suspended',
    });

    expect(reload).toHaveBeenCalledTimes(1);
  });

  // @traces 067-FR-007
  it('reads the account again when its garage is put back on the map, so the banner goes at once', async () => {
    await render('garage', '/app/garage', []);

    live.events.next({
      at: '2026-10-23T09:00:00.000Z',
      id: 'garage-1',
      kind: 'garage.restored',
    });

    expect(reload).toHaveBeenCalledTimes(1);
  });

  // @traces 1354-FR-007
  it('reads the account again when its garage is re-checked, so the RAR line follows', async () => {
    await render('garage', '/app/garage', []);

    live.events.next({
      at: '2026-11-01T09:00:00.000Z',
      id: 'garage-1',
      kind: 'recheck.recorded',
    });

    expect(reload).toHaveBeenCalledTimes(1);
  });

  // @traces 101-FR-006
  it('reads the account again when its garage’s file is decided, so an approval opens the dashboard', async () => {
    await render('garage', '/app/garage', []);

    live.events.next({
      at: '2027-03-04T09:00:00.000Z',
      id: 'file-1',
      kind: 'verification.decided',
    });

    expect(reload).toHaveBeenCalledTimes(1);
  });

  // @traces 101-FR-007
  it('leaves a draft garage’s owner only "Ajutor și contact" in the menu and the bar, and the header’s tools', async () => {
    const { element } = await render(
      'garage',
      '/app/garage',
      OWNER,
      '/app/garage',
      draftAtelier(),
    );

    expect(menu(element)).toEqual([]);
    expect(bar(element)).toEqual([]);
    expect(
      [...element.querySelectorAll('aside nav button')].map((b) =>
        b.textContent?.trim(),
      ),
    ).toEqual(['Ajutor și contact']);
    expect(
      [
        ...element.querySelectorAll('mf-dashboard-tab-bar nav button .label'),
      ].map((b) => b.textContent?.trim()),
    ).toEqual(['Ajutor și contact']);
    expect(element.querySelector('header mf-bell')).not.toBeNull();
    expect(element.querySelector('header mf-language-switch')).not.toBeNull();
    expect(
      [...element.querySelectorAll('aside .account button')].map((b) =>
        b.textContent?.trim(),
      ),
    ).toContain('Ieși din cont');
    expect(element.querySelector('mf-verification-progress')).not.toBeNull();
  });

  // @traces 101-FR-006 101-FR-007
  it('gives the menu back once the garage is approved and moves the focus to the dashboard’s title', async () => {
    const { current, element, harness } = await render(
      'garage',
      '/app/garage',
      OWNER,
      '/app/garage',
      draftAtelier(),
    );
    expect(menu(element)).toEqual([]);

    current.set(me('garage', '/app/garage', OWNER, atelier()));
    await settle(harness);

    expect(menu(element)).toEqual([
      'Panou',
      'Cereri de ofertă',
      'Programări',
      'Lucrări',
      'Mecanici',
      'Prețuri',
      'Recenzii',
      'Profilul service‑ului',
      'Setări',
      'Istoric modificări',
    ]);
    expect(element.querySelector('mf-verification-progress')).toBeNull();
    expect(title(element)).toBe('Panou service');
    expect(document.activeElement).toBe(element.querySelector('header h1'));
  });

  // @traces 101-FR-007
  it('sends a draft garage’s owner from a view back to the dashboard', async () => {
    const { element } = await render(
      'garage',
      '/app/garage',
      OWNER,
      '/app/garage/requests',
      draftAtelier(),
    );

    expect(url()).toBe('/app/garage');
    expect(element.querySelector('mf-verification-progress')).not.toBeNull();
  });

  // @traces 101-FR-001 101-FR-012
  it('titles a draft garage’s dashboard by its verification, in the page’s one h1, in both languages', async () => {
    const { element, harness } = await render(
      'garage',
      '/app/garage',
      OWNER,
      '/app/garage',
      draftAtelier(),
    );

    expect(title(element)).toBe('Profilul tău e în verificare');
    expect(element.querySelectorAll('h1')).toHaveLength(1);

    await TestBed.inject(I18n).use('en');
    await settle(harness);

    expect(title(element)).toBe('Your profile is being checked');
    expect(element.querySelectorAll('h1')).toHaveLength(1);
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
const reviewsEntry = (element: HTMLElement) =>
  menuLinks(element).find(
    (a) => a.getAttribute('href') === '/app/admin/reviews',
  );
const reviewsTab = (element: HTMLElement) =>
  bar(element).find((a) => a.getAttribute('href') === '/app/admin/reviews');
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
    [0, 'MotorFix · Toată țara · niciun service nu așteaptă verificarea'],
    [1, 'MotorFix · Toată țara · 1 service așteaptă verificarea'],
    [4, 'MotorFix · Toată țara · 4 service‑uri așteaptă verificarea'],
    [20, 'MotorFix · Toată țara · 20 de service‑uri așteaptă verificarea'],
    [101, 'MotorFix · Toată țara · 101 service‑uri așteaptă verificarea'],
  ])('reads %i waiting in Romanian', async (count, text) => {
    const { element } = await admin(count);

    expect(line(element)).toBe(text);
  });

  it.each([
    [0, 'MotorFix · Whole country · no garage is waiting for verification'],
    [1, 'MotorFix · Whole country · 1 garage is waiting for verification'],
    [5, 'MotorFix · Whole country · 5 garages are waiting for verification'],
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
    expect(garagesEntry(element)?.hasAttribute('aria-label')).toBe(false);
    expect(spoken(garagesEntry(element))).toBe('Service‑uri 4 în așteptare');
    expect(element.querySelectorAll('aside nav .chip')).toHaveLength(1);
    expect(element.querySelectorAll('mf-dashboard-tab-bar .chip')).toHaveLength(
      1,
    );
  });

  it('shows no count on the garages entry when none waits', async () => {
    const { element } = await admin(0);

    expect(garagesEntry(element)?.querySelector('.chip')).toBeNull();
    expect(garagesEntry(element)?.hasAttribute('aria-label')).toBe(false);
    expect(spoken(garagesEntry(element))).not.toMatch(/așteptare|waiting/);
    expect(element.querySelectorAll('.chip-skeleton')).toHaveLength(0);
  });

  it('shows a skeleton in place of the count while the first read runs', async () => {
    waiting = () => new Promise(() => undefined);
    const { element, harness } = await render('admin', '/app/admin', ADMIN);
    await settle(harness);

    expect(element.querySelector('.admin-line .skeleton')).not.toBeNull();
    expect(line(element)).toBe('MotorFix · Toată țara ·');
    expect(element.querySelectorAll('.chip')).toHaveLength(0);
    expect(element.querySelectorAll('aside nav .chip-skeleton')).toHaveLength(
      2,
    );
    expect(
      garagesEntry(element)?.querySelector('.chip-skeleton'),
    ).not.toBeNull();
    expect(
      reviewsEntry(element)?.querySelector('.chip-skeleton'),
    ).not.toBeNull();
    expect(
      element.querySelectorAll('mf-dashboard-tab-bar .chip-skeleton'),
    ).toHaveLength(2);
  });

  it('hides the count everywhere when the read fails, never showing 0', async () => {
    const { element } = await admin(new Error('offline'));

    expect(line(element)).toBe('MotorFix · Toată țara');
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
      'MotorFix · Toată țara · 3 service‑uri așteaptă verificarea',
    );
    expect(
      garagesEntry(element)?.querySelector('.chip')?.textContent?.trim(),
    ).toBe('3');
  });

  it('turns the counted entry English with the language', async () => {
    const { element, harness } = await admin(4);
    await TestBed.inject(I18n).use('en');
    await settle(harness);

    expect(garagesEntry(element)?.hasAttribute('aria-label')).toBe(false);
    expect(spoken(garagesEntry(element))).toBe('Garages 4 waiting');
  });

  it('shows no admin line on another dashboard and reads no overview there', async () => {
    const { element } = await render('garage', '/app/garage', OWNER);

    expect(element.querySelector('.admin-line')).toBeNull();
    expect(element.querySelector('.admin-label')).toBeNull();
    expect(overview).not.toHaveBeenCalled();
  });
});

// @traces 1389-FR-001 1389-FR-006
describe('the reported reviews counter', () => {
  afterEach(() => {
    waiting = async () => ({ garagesWaiting: 0 });
  });

  async function reported(pending: number) {
    waiting = async () => ({ garagesWaiting: 0, reportsPending: pending });
    const rendered = await render('admin', '/app/admin', ADMIN);
    await settle(rendered.harness);
    return rendered;
  }

  it('puts the pending reports on the Recenzii raportate entry and tab, with the count in its name', async () => {
    const { element } = await reported(3);

    expect(
      reviewsEntry(element)?.querySelector('.chip')?.textContent?.trim(),
    ).toBe('3');
    expect(spoken(reviewsEntry(element))).toBe(
      'Recenzii raportate 3 în așteptare',
    );
    expect(
      reviewsTab(element)?.querySelector('.chip')?.textContent?.trim(),
    ).toBe('3');
    expect(reviewsEntry(element)?.textContent).not.toMatch(/curând/);
  });

  it('shows no number when nothing is reported', async () => {
    const { element } = await reported(0);

    expect(reviewsEntry(element)?.querySelector('.chip')).toBeNull();
    expect(reviewsTab(element)?.querySelector('.chip')).toBeNull();
  });

  it('shows no number when the read fails', async () => {
    waiting = async () => {
      throw new Error('offline');
    };
    const { element, harness } = await render('admin', '/app/admin', ADMIN);
    await settle(harness);

    expect(reviewsEntry(element)?.querySelector('.chip')).toBeNull();
    expect(reviewsEntry(element)?.querySelector('.chip-skeleton')).toBeNull();
  });

  it('moves the number when a review is reported, without a reload', async () => {
    const { element, harness } = await reported(1);

    waiting = async () => ({ garagesWaiting: 0, reportsPending: 2 });
    live.events.next({
      at: '2026-10-30T09:00:00.000Z',
      id: 'review-9',
      kind: 'review.reported',
    });
    await pause(400);
    await settle(harness);

    expect(
      reviewsEntry(element)?.querySelector('.chip')?.textContent?.trim(),
    ).toBe('2');
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

// @traces 244-FR-002 1204-FR-013
describe('Frame consent bar', () => {
  // First in the frame, so the first Tab after the skip link lands in it; the
  // style sheet then draws it last, on the tab bar on a phone and at the foot
  // of the view from a tablet up.
  it('comes first in the frame and is drawn last, on the tab bar on a phone', async () => {
    const { element } = await render('driver', '/app/driver', []);

    const frame = element.querySelector('aside')?.parentElement;
    const top = [...(frame?.children ?? [])].map((child) =>
      child.tagName.toLowerCase(),
    );
    expect(top.slice(0, 3)).toEqual(['mf-consent-bar', 'aside', 'div']);
    const view = [...(element.querySelector('.view')?.children ?? [])].map(
      (child) => child.tagName.toLowerCase(),
    );
    expect(view.slice(view.indexOf('main'))).toEqual([
      'main',
      'mf-dashboard-tab-bar',
    ]);
    const css = readFileSync(join(__dirname, 'frame.css'), 'utf8').replace(
      /\s+/g,
      ' ',
    );
    expect(css).toMatch(
      /@media \(max-width: 767\.98px\) \{ :host \{ --tab-bar:/,
    );
    expect(css).toMatch(/mf-consent-bar \{[^}]*order: 1;/);
    expect(css).toMatch(/mf-dashboard-tab-bar \{[^}]*order: 2;/);
    expect(css).toMatch(
      /@media \(min-width: 768px\) \{.*mf-consent-bar \{[^}]*grid-area: 1 \/ 2;[^}]*align-self: end;/,
    );
    // The bar's own height is any number of pixels: the room kept for it
    // rounds up to the 4 px grid.
    expect(css).toMatch(
      /\.view \{[^}]*padding-bottom: round\(up, var\(--consent-bar, 0px\), 4px\);/,
    );
  });
});

// @traces 248-FR-001
describe('Frame bars on a phone', () => {
  // A sticky box cannot leave the box it sits in. Inside the view, which
  // starts under the account block on a phone, a tall consent bar stopped at
  // the view's top and slid under the tab bar at 320 px. On a phone the view
  // lends its children to the frame, so both bars stick within the whole
  // frame and the consent bar always rests on the tab bar.
  it('let the consent bar and the tab bar stick within the whole frame', () => {
    const css = readFileSync(join(__dirname, 'frame.css'), 'utf8').replace(
      /\s+/g,
      ' ',
    );
    const phone = [
      ...css.matchAll(/@media \(max-width: 767\.98px\) \{(.*?)\} \}/g),
    ]
      .map(([, body]) => body)
      .join(' ');

    expect(phone).toMatch(
      /:host \{[^}]*display: flex;[^}]*flex-direction: column/,
    );
    expect(phone).toMatch(/\.view \{[^}]*display: contents/);
  });
});

describe('Frame side links', () => {
  const sheet = () =>
    readFileSync(join(__dirname, 'frame.css'), 'utf8').replace(/\s+/g, ' ');

  it('paint the wordmark in the theme, not the browser link colours', () => {
    const rule = /\.logo \{([^}]*)\}/.exec(sheet())?.[1] ?? '';
    expect(rule).toContain('color: var(--mf-text)');
    expect(rule).toContain('text-decoration: none');
    expect(rule).toContain('font-family: var(--mf-font-label)');
    expect(rule).toContain('min-height: var(--mf-tap)');
  });

  it('paint the menu links in the theme, with the current one in amber ink', () => {
    const css = sheet();
    const rule = /aside nav a \{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(rule).toContain('color: var(--mf-text-secondary)');
    expect(rule).toContain('text-decoration: none');
    expect(rule).toContain('min-height: var(--mf-tap)');
    expect(css).toMatch(
      /aside nav a\[aria-current="page"\] \{[^}]*color: var\(--mf-amber-ink\)/,
    );
  });

  it('marks the wordmark link with the logo class', () => {
    const html = readFileSync(join(__dirname, 'frame.html'), 'utf8');
    expect(html).toMatch(/<a class="logo" routerLink="\/"/);
  });
});

describe('Frame account buttons', () => {
  it('are styled tap targets in body text, padded on the 4 px grid', () => {
    const css = readFileSync(join(__dirname, 'frame.css'), 'utf8').replace(
      /\s+/g,
      ' ',
    );
    const rule = /\.account > button \{([^}]*)\}/.exec(css)?.[1] ?? '';

    expect(rule).toContain('min-height: var(--mf-tap)');
    expect(rule).toContain('padding: 0 var(--mf-space-3)');
    expect(rule).toContain('font: inherit');
    expect(rule).toContain('font-size: var(--mf-size-body)');
  });
});

const requestsEntry = (element: HTMLElement) =>
  menuLinks(element).find(
    (a) => a.getAttribute('href') === '/app/garage/requests',
  );
const requestsTab = (element: HTMLElement) =>
  bar(element).find((a) => a.getAttribute('href') === '/app/garage/requests');
const chip = (link: Element | undefined) =>
  link?.querySelector('.chip')?.textContent?.trim();

async function garage(total: number, capabilities = OWNER) {
  requests = async () => ({ items: [], nextCursor: null, total });
  const rendered = await render(
    'garage',
    '/app/garage',
    capabilities,
    '/app/garage/schedule',
    atelier(),
  );
  await settle(rendered.harness);
  await pause(0);
  await settle(rendered.harness);
  return rendered;
}

// @traces 343-FR-001
// @traces 343-FR-007
describe('the requests count on the garage menu and bar', () => {
  afterEach(() => {
    requests = async () => ({ items: [], nextCursor: null, total: 0 });
  });

  it('puts the waiting count on the Cereri de ofertă entry and tab, with the count in their names', async () => {
    const { element } = await garage(3);

    expect(requestReads).toHaveBeenCalledWith({ status: 'waiting' });
    expect(chip(requestsEntry(element))).toBe('3');
    expect(chip(requestsTab(element))).toBe('3');
    expect(requestsEntry(element)?.hasAttribute('aria-label')).toBe(false);
    expect(spoken(requestsEntry(element))).toBe(
      'Cereri de ofertă 3 în așteptare',
    );
    expect(element.querySelectorAll('aside nav .chip')).toHaveLength(1);
  });

  it('shows no number at zero', async () => {
    const { element } = await garage(0);

    expect(chip(requestsEntry(element))).toBeUndefined();
    expect(chip(requestsTab(element))).toBeUndefined();
    expect(requestsEntry(element)?.hasAttribute('aria-label')).toBe(false);
    expect(spoken(requestsEntry(element))).not.toMatch(/așteptare|waiting/);
  });

  it('moves the count when a request arrives, without a reload', async () => {
    const { element, harness } = await garage(1);

    requests = async () => ({ items: [], nextCursor: null, total: 2 });
    live.events.next({
      at: '2026-10-09T09:00:00.000Z',
      id: 'req-2',
      kind: 'request.created',
    });
    await pause(400);
    await settle(harness);

    expect(chip(requestsEntry(element))).toBe('2');
    expect(chip(requestsTab(element))).toBe('2');
  });
});

// @traces 343-FR-015
describe('the requests entry for each garage role', () => {
  it.each([
    ['the receptionist', ['garage.requests', 'garage.schedule']],
    [
      'a mechanic who may answer quotes',
      ['garage.own_jobs', 'garage.requests'],
    ],
  ])('shows %s the entry, the tab and the count', async (_, capabilities) => {
    const { element } = await garage(2, capabilities);

    expect(chip(requestsEntry(element))).toBe('2');
    expect(chip(requestsTab(element))).toBe('2');
  });

  it('shows a mechanic without the permission no entry, no tab and no count, without a call', async () => {
    const { element } = await garage(2, ['garage.own_jobs']);

    expect(requestsEntry(element)).toBeUndefined();
    expect(requestsTab(element)).toBeUndefined();
    expect(element.querySelectorAll('.chip')).toHaveLength(0);
    expect(requestReads).not.toHaveBeenCalled();
  });

  it('reads no requests on the driver or admin dashboards', async () => {
    await render('driver', '/app/driver', ['driver.requests']);

    expect(requestReads).not.toHaveBeenCalled();
  });
});
