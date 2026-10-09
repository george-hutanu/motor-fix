import { HttpErrorResponse } from '@angular/common/http';
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router, RouterOutlet } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import {
  GarageRequestsService,
  type MeDto,
  NotificationsService,
} from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';
import { NEVER, Subject } from 'rxjs';

import { AdminOverview } from './admin-overview';
import { AdminPanel } from './admin-panel/admin-panel';
import { AdminUsers } from './admin-users/admin-users';
import { CarsView } from './cars-view/cars-view';
import { DriverHome } from './driver-home/driver-home';
import { DriverSettingsView } from './driver-settings-view/driver-settings-view';
import { GarageHome } from './garage-requests/garage-home/garage-home';
import { GarageRequestsFeed } from './garage-requests/garage-requests-feed';
import { GarageRequestsView } from './garage-requests/garage-requests-view/garage-requests-view';
import { JobsView } from './jobs-view/jobs-view';
import { Live } from './live';
import { RequestsView } from './requests-view/requests-view';
import { Session } from './session';
import { allowedViews, DASHBOARDS, dashboardRoutes } from './views';

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
const RECEPTIONIST = [
  'garage.requests',
  'garage.schedule',
  'garage.final_price',
  'garage.own_jobs',
  'garage.audit_history',
];

// Each key's text in Romanian, then in English (a missing key reads as itself).
async function texts(keys: readonly (string | undefined)[]) {
  const i18n = TestBed.inject(I18n);
  const read = () => keys.map((key) => (key ? i18n.t(key) : undefined));
  const ro = read();
  await i18n.use('en');
  return { en: read(), ro };
}

const paths = (area: 'driver' | 'garage' | 'admin', capabilities: string[]) =>
  allowedViews(area, capabilities).map((view) => view.path);

describe('the dashboard view lists', () => {
  // @traces 028-FR-001
  it('lists the driver views in menu order, each with its address, labels and capability', () => {
    expect(DASHBOARDS.driver.views).toEqual([
      {
        label: 'shell.frame.nav.dashboard',
        load: expect.any(Function),
        path: '',
        tab: 'shell.frame.tab.dashboard',
        title: 'shell.frame.title.driver.dashboard',
      },
      {
        capability: 'driver.requests',
        label: 'shell.frame.nav.driver.requests',
        load: expect.any(Function),
        path: 'requests',
        tab: 'shell.frame.tab.requests',
        title: 'shell.frame.title.driver.requests',
      },
      {
        body: CarsView,
        capability: 'driver.cars',
        label: 'shell.frame.nav.driver.cars',
        path: 'cars',
        tab: 'shell.frame.tab.cars',
        title: 'shell.frame.title.driver.cars',
      },
      {
        capability: 'driver.reviews',
        label: 'shell.frame.nav.driver.reviews',
        path: 'reviews',
        tab: 'shell.frame.tab.reviews',
        title: 'shell.frame.title.driver.reviews',
      },
      {
        capability: 'driver.saved_garages',
        label: 'shell.frame.nav.driver.savedGarages',
        path: 'saved',
        tab: 'shell.frame.tab.saved',
        title: 'shell.frame.title.driver.saved',
      },
      {
        label: 'shell.frame.nav.driver.assistant',
        path: 'assistant',
        tab: 'shell.frame.tab.ai',
        title: 'shell.frame.title.driver.assistant',
        unreleased: true,
      },
      {
        body: DriverSettingsView,
        capability: 'driver.settings',
        label: 'shell.frame.nav.driver.settings',
        path: 'settings',
        push: true,
        subtitle: 'shell.frame.subtitle.driver.settings',
        tab: 'shell.frame.tab.settings',
        title: 'shell.frame.title.driver.settings',
      },
    ]);
  });

  // @traces 097-FR-001
  // The driver's home and request list load with their view, so the first
  // page any visitor opens does not carry them (the initial bundle budget).
  it('loads the driver home and the request list only when their view opens', async () => {
    const [home, requests] = DASHBOARDS.driver.views;

    expect(home.body).toBeUndefined();
    expect(requests.body).toBeUndefined();
    expect(await home.load?.()).toBe(DriverHome);
    expect(await requests.load?.()).toBe(RequestsView);
  });

  // @traces 343-FR-006
  // @traces 343-FR-007
  it('loads the garage Panou and Cereri de ofertă only when their view opens', async () => {
    const [home, requests] = DASHBOARDS.garage.views;

    expect(home.body).toBeUndefined();
    expect(requests.body).toBeUndefined();
    expect(await home.load?.()).toBe(GarageHome);
    expect(await requests.load?.()).toBe(GarageRequestsView);
    expect(requests.counter).toBe('requestsWaiting');
  });

  it('gives the garage and admin dashboards their addresses in menu order', () => {
    expect(DASHBOARDS.garage.views.map((view) => view.path)).toEqual([
      '',
      'requests',
      'schedule',
      'jobs',
      'team',
      'prices',
      'reviews',
      'profile',
      'assistant',
      'settings',
      'history',
    ]);
    expect(DASHBOARDS.admin.views.map((view) => view.path)).toEqual([
      '',
      'garages',
      'users',
      'reviews',
      'catalogue',
      'assistant',
      'settings',
    ]);
  });

  it('lists the admin views with their labels, capabilities, release marks and counter', () => {
    expect(DASHBOARDS.admin.views).toEqual([
      {
        body: AdminPanel,
        label: 'shell.frame.nav.dashboard',
        path: '',
        tab: 'shell.frame.tab.overview',
      },
      {
        capability: 'admin.garages',
        counter: 'garagesWaiting',
        label: 'shell.frame.nav.admin.garages',
        path: 'garages',
        tab: 'shell.frame.tab.garages',
      },
      {
        capability: 'admin.users',
        label: 'shell.frame.nav.admin.users',
        load: expect.any(Function),
        path: 'users',
        tab: 'shell.frame.tab.users',
      },
      {
        capability: 'admin.reviews',
        label: 'shell.frame.nav.admin.reviews',
        path: 'reviews',
        tab: 'shell.frame.tab.reported',
        unreleased: true,
      },
      {
        capability: 'admin.catalogue',
        label: 'shell.frame.nav.admin.catalogue',
        path: 'catalogue',
        tab: 'shell.frame.tab.brands',
        unreleased: true,
      },
      {
        capability: 'admin.settings',
        label: 'shell.frame.nav.admin.assistant',
        path: 'assistant',
        tab: 'shell.frame.tab.assistant',
        unreleased: true,
      },
      {
        capability: 'admin.settings',
        label: 'shell.frame.nav.admin.settings',
        path: 'settings',
        push: true,
        staff: true,
        tab: 'shell.frame.tab.settings',
      },
    ]);
  });

  it('downloads the admin users view when it is opened, not with the first page', async () => {
    const users = DASHBOARDS.admin.views.find((view) => view.path === 'users');

    await expect(users?.load?.()).resolves.toBe(AdminUsers);
  });

  it('names each dashboard for its bar and tags it for its menu', () => {
    expect(DASHBOARDS.driver.name).toBe('shell.frame.bar.driver');
    expect(DASHBOARDS.garage.name).toBe('shell.frame.bar.garage');
    expect(DASHBOARDS.admin.name).toBe('shell.frame.bar.admin');
    expect(DASHBOARDS.garage.tag).toBe('shell.frame.area.garage');
  });

  it('gives a garage owner every released garage view', () => {
    expect(paths('garage', OWNER)).toEqual([
      '',
      'requests',
      'schedule',
      'jobs',
      'team',
      'prices',
      'reviews',
      'profile',
      'settings',
      'history',
    ]);
  });

  it('keeps the team, the prices and the garage profile from a receptionist', () => {
    expect(paths('garage', RECEPTIONIST)).toEqual([
      '',
      'requests',
      'schedule',
      'jobs',
      'settings',
      'history',
    ]);
  });

  it('gives a mechanic the dashboard view, the settings and what their permissions allow', () => {
    expect(
      paths('garage', ['garage.own_jobs', 'garage.audit_history']),
    ).toEqual(['', 'jobs', 'settings', 'history']);
    expect(
      paths('garage', [
        'garage.own_jobs',
        'garage.audit_history',
        'garage.requests',
        'garage.schedule',
      ]),
    ).toEqual(['', 'requests', 'schedule', 'jobs', 'settings', 'history']);
  });

  // @traces 424-FR-012
  it('gives every garage role the jobs view, with its body, between the schedule and the team', async () => {
    const jobs = DASHBOARDS.garage.views.find((view) => view.path === 'jobs');
    expect(jobs).toEqual({
      capability: 'garage.own_jobs',
      empty: 'shell.frame.coming.garage.jobs',
      label: 'shell.frame.nav.garage.jobs',
      load: expect.any(Function),
      path: 'jobs',
      subtitle: 'shell.frame.subtitle.garage.jobs',
      tab: 'shell.frame.tab.jobs',
      title: 'shell.frame.title.garage.jobs',
    });
    // Downloaded with the view, not with the first page.
    await expect(jobs?.load?.()).resolves.toBe(JobsView);
    const route = dashboardRoutes('garage').find((r) => r.path === 'jobs');
    expect(route?.children?.[0].component).toBeUndefined();
    await expect(route?.children?.[0].loadComponent?.()).resolves.toBe(
      JobsView,
    );
    for (const role of [OWNER, RECEPTIONIST, ['garage.own_jobs']])
      expect(paths('garage', role)).toContain('jobs');
    expect(paths('garage', ['garage.audit_history'])).not.toContain('jobs');
  });

  // @traces 198-FR-011
  it('gives the garage a settings view with no capability, carrying the push and staff panels', () => {
    expect(
      DASHBOARDS.garage.views.find((view) => view.path === 'settings'),
    ).toEqual({
      label: 'shell.frame.nav.garage.settings',
      path: 'settings',
      push: true,
      staff: true,
      subtitle: 'shell.frame.subtitle.garage.settings',
      tab: 'shell.frame.tab.settings',
      title: 'shell.frame.title.garage.settings',
    });
    expect(DASHBOARDS.garage.views[0].push).toBeUndefined();
  });

  // @traces 198-FR-011
  it('puts the staff panel in the admin settings and leaves the driver settings as they were', () => {
    const settings = (area: 'driver' | 'admin') =>
      DASHBOARDS[area].views.find((view) => view.path === 'settings');
    expect(settings('admin')?.staff).toBe(true);
    expect(settings('admin')?.push).toBe(true);
    expect(settings('driver')?.staff).toBeUndefined();
    expect(settings('driver')?.push).toBe(true);
  });

  it('gives an admin the released admin views only', () => {
    expect(
      paths('admin', [
        'admin.garages',
        'admin.users',
        'admin.reviews',
        'admin.catalogue',
        'admin.settings',
        'admin.audit_history',
      ]),
    ).toEqual(['', 'garages', 'users', 'settings']);
  });

  it('hides an unreleased view even from a role that may open it', () => {
    expect(paths('admin', ['admin.reviews'])).toEqual(['']);
  });

  // @traces 097-FR-002
  it('marks the driver and garage assistants unreleased, and no other garage view', () => {
    const marked = (area: 'driver' | 'garage') =>
      DASHBOARDS[area].views
        .filter((view) => view.unreleased)
        .map((view) => view.path);

    expect(marked('driver')).toEqual(['assistant']);
    expect(marked('garage')).toEqual(['assistant']);
  });

  it('gives a driver the six released views, never the assistant', () => {
    expect(
      paths('driver', [
        'driver.requests',
        'driver.cars',
        'driver.reviews',
        'driver.saved_garages',
        'driver.settings',
      ]),
    ).toEqual(['', 'requests', 'cars', 'reviews', 'saved', 'settings']);
    expect(paths('driver', [])).toEqual(['']);
  });

  it('routes no unreleased driver view', () => {
    const routed = dashboardRoutes('driver').map((route) => route.path);

    expect(routed).not.toContain('assistant');
    expect(routed).toContain('settings');
  });

  it('gives the admin views no title of their own', () => {
    const titled = DASHBOARDS.admin.views
      .filter((view) => view.title || view.subtitle)
      .map((view) => view.path);

    expect(titled).toEqual([]);
  });

  // @traces 097-FR-002 097-FR-003 097-FR-004
  it('gives every garage view a title, every one but Panou a subtitle, and every one but Setări an empty state, in both languages', async () => {
    const views = DASHBOARDS.garage.views;
    const keys = views
      .flatMap((v) => [v.label, v.tab, v.title, v.subtitle, v.empty])
      .filter((key): key is string => !!key);
    const { en, ro } = await texts(keys);

    expect(views.every((view) => view.title)).toBe(true);
    expect(views.filter((v) => !v.subtitle).map((v) => v.path)).toEqual([
      '',
      'assistant',
    ]);
    expect(views.filter((v) => !v.empty).map((v) => v.path)).toEqual([
      'assistant',
      'settings',
    ]);
    expect(keys.filter((key, i) => ro[i] === key)).toEqual([]);
    expect(keys.filter((key, i) => en[i] === key)).toEqual([]);
  });

  // @traces 097-FR-002 097-FR-003
  it('names Istoric modificări and Asistent AI, and calls Programări Schedule in English', async () => {
    const view = (path: string) =>
      DASHBOARDS.garage.views.find((v) => v.path === path);
    const history = view('history');
    const ai = view('assistant');
    const schedule = view('schedule');

    expect(history?.capability).toBe('garage.audit_history');
    expect(
      await texts([
        history?.label,
        history?.tab,
        ai?.label,
        ai?.title,
        schedule?.label,
        schedule?.title,
        DASHBOARDS.garage.tag,
      ]),
    ).toEqual({
      en: [
        'Change history',
        'History',
        'AI assistant',
        'Your AI assistant',
        'Schedule',
        'Schedule',
        'GARAGE ACCOUNT',
      ],
      ro: [
        'Istoric modificări',
        'Istoric',
        'Asistent AI',
        'Asistentul tău AI',
        'Programări',
        'Programări',
        'CONT SERVICE',
      ],
    });
  });

  // @traces 097-FR-007
  it('drops a view whose feature the garage switched off, and keeps it while the feature is on or unknown', () => {
    expect(
      allowedViews('garage', OWNER, { team_mechanics: false }).map(
        (v) => v.path,
      ),
    ).not.toContain('team');
    expect(
      allowedViews('garage', OWNER, { team_mechanics: true }).map(
        (v) => v.path,
      ),
    ).toContain('team');
    expect(allowedViews('garage', OWNER, {}).map((v) => v.path)).toContain(
      'team',
    );
    expect(
      allowedViews('garage', OWNER, { whatsapp: false }).map((v) => v.path),
    ).toEqual(paths('garage', OWNER));
  });
});

@Component({ imports: [RouterOutlet], template: '<router-outlet />' })
class Shell {}

const ADMIN = [
  'admin.garages',
  'admin.users',
  'admin.reviews',
  'admin.catalogue',
  'admin.settings',
  'admin.audit_history',
];

const ATELIER = 'garage-1';

// What the garage's request list answers; the server's 404 means not allowed.
let requestList: () => Promise<unknown>;
beforeEach(() => {
  requestList = async () => ({ items: [], nextCursor: null, total: 0 });
});
const access = (
  status: 'draft' | 'approved' | 'suspended' = 'approved',
  features: Record<string, boolean> = {},
) => [
  {
    features,
    garageId: ATELIER,
    name: 'Atelier Test',
    permissions: {
      canAnswerQuotes: true,
      canMoveBookings: true,
      canRecordFinalPrice: true,
    },
    role: 'owner',
    status,
  },
];

async function open(
  url: string,
  capabilities: string[],
  area: 'driver' | 'garage' | 'admin' = 'garage',
  garageAccess = access(),
) {
  const current = signal({
    capabilities,
    garageAccess,
    garageId: ATELIER,
  } as unknown as MeDto);
  TestBed.configureTestingModule({
    providers: [
      provideRouter([
        {
          children: dashboardRoutes(area),
          component: Shell,
          path: `app/${area}`,
        },
      ]),
      { provide: Session, useValue: { current, shown: current } },
      {
        provide: NotificationsService,
        useValue: {
          notificationPreferencesControllerRead: async () => ({ staff: [] }),
        },
      },
      {
        provide: Live,
        useValue: {
          events: new Subject(),
          offline: signal(false),
          on: () => NEVER,
          resync: new Subject(),
          state: signal('open'),
        },
      },
      GarageRequestsFeed,
      {
        provide: GarageRequestsService,
        useValue: { garageRequestsControllerList: () => requestList() },
      },
      {
        provide: AdminOverview,
        useValue: {
          city: signal('all'),
          failed: signal(false),
          figures: signal(undefined),
          figuresLoading: signal(false),
          loading: signal(true),
          period: signal('default'),
        },
      },
    ],
  });
  const harness = await RouterTestingHarness.create();
  await harness.navigateByUrl(url);
  return { element: harness.routeNativeElement as HTMLElement, harness };
}

describe('the dashboard view routes', () => {
  // @traces 097-FR-004
  it('opens an allowed view at its own address, with the empty state of that view', async () => {
    const { element } = await open('/app/garage/team', OWNER);

    expect(TestBed.inject(Router).url).toBe('/app/garage/team');
    expect(element.textContent).toContain(
      'Aici vei vedea mecanicii service‑ului și ce poate face fiecare.',
    );
    expect(element.textContent).not.toContain('Nimic aici încă.');
  });

  // @traces 097-FR-004
  it('keeps the shared placeholder for a driver view with no empty state of its own', async () => {
    const { element } = await open(
      '/app/driver/reviews',
      ['driver.reviews'],
      'driver',
    );

    expect(element.textContent).toContain('Nimic aici încă.');
  });

  // @traces 097-FR-001
  it('opens the change history for an owner, and sends one without the right to the dashboard', async () => {
    const { element } = await open('/app/garage/history', OWNER);

    expect(TestBed.inject(Router).url).toBe('/app/garage/history');
    expect(element.textContent).toContain(
      'Aici vei vedea cine a schimbat ce în service.',
    );
    TestBed.resetTestingModule();
    await open('/app/garage/history', ['garage.own_jobs']);
    expect(TestBed.inject(Router).url).toBe('/app/garage');
  });

  // @traces 097-FR-002
  it('sends an owner who types the unreleased assistant address to the dashboard', async () => {
    await open('/app/garage/assistant', OWNER);

    expect(TestBed.inject(Router).url).toBe('/app/garage');
  });

  // @traces 097-FR-007
  it('sends the team address to the dashboard while the garage has mechanics switched off', async () => {
    await open(
      '/app/garage/team',
      OWNER,
      'garage',
      access('approved', { team_mechanics: false }),
    );

    expect(TestBed.inject(Router).url).toBe('/app/garage');
  });

  // @traces 097-FR-007
  it('opens the team address while mechanics is switched on', async () => {
    await open(
      '/app/garage/team',
      OWNER,
      'garage',
      access('approved', { team_mechanics: true }),
    );

    expect(TestBed.inject(Router).url).toBe('/app/garage/team');
  });

  it('opens the dashboard view at the dashboard address', async () => {
    await open('/app/garage', OWNER);

    expect(TestBed.inject(Router).url).toBe('/app/garage');
  });

  it('sends a receptionist who types the team address to the dashboard', async () => {
    await open('/app/garage/team', RECEPTIONIST);

    expect(TestBed.inject(Router).url).toBe('/app/garage');
  });

  // @traces 198-FR-011
  it('opens the garage settings for every garage role, with the push panel and the notification settings', async () => {
    const { element } = await open('/app/garage/settings', ['garage.own_jobs']);

    expect(TestBed.inject(Router).url).toBe('/app/garage/settings');
    expect(element.querySelector('mf-push-panel')).not.toBeNull();
    expect(element.querySelector('mf-notification-settings')).not.toBeNull();
  });

  // @traces 198-FR-011
  it('no longer carries the push panel on the garage home view', async () => {
    const { element } = await open('/app/garage', OWNER);

    expect(element.querySelector('mf-push-panel')).toBeNull();
  });

  it('sends an unknown view address to the dashboard', async () => {
    await open('/app/garage/nope', OWNER);

    expect(TestBed.inject(Router).url).toBe('/app/garage');
  });

  it.each(['reviews', 'catalogue', 'assistant'])(
    'sends an admin who types the unreleased %s address to the dashboard',
    async (path) => {
      await open(`/app/admin/${path}`, ADMIN, 'admin');

      expect(TestBed.inject(Router).url).toBe('/app/admin');
    },
  );

  // @traces 028-FR-001
  it('sends a driver who types the unreleased assistant address to the dashboard', async () => {
    await open(
      '/app/driver/assistant',
      ['driver.requests', 'driver.settings'],
      'driver',
    );

    expect(TestBed.inject(Router).url).toBe('/app/driver');
  });

  it('opens the platform figures on the admin dashboard address', async () => {
    const { element } = await open('/app/admin', ADMIN, 'admin');

    expect(TestBed.inject(Router).url).toBe('/app/admin');
    expect(element.querySelector('mf-admin-panel')).not.toBeNull();
  });

  // @traces 097-FR-004 097-FR-008
  // @traces 343-FR-006
  it('shows the requests panel, not the empty state, on the garage dashboard address of an approved or suspended garage', async () => {
    for (const status of ['approved', 'suspended'] as const) {
      TestBed.resetTestingModule();
      const { element } = await open(
        '/app/garage',
        OWNER,
        'garage',
        access(status),
      );

      expect(element.querySelector('mf-admin-panel')).toBeNull();
      expect(element.querySelector('mf-garage-requests-panel')).not.toBeNull();
      expect(element.textContent).not.toContain(
        'Aici vei vedea ce se întâmplă azi în service.',
      );
      expect(element.textContent).not.toContain(
        'Profilul tău e în verificare.',
      );
    }
  });

  // @traces 097-FR-008
  it('says a draft garage’s profile is being checked on its dashboard, and only there', async () => {
    const { element, harness } = await open(
      '/app/garage',
      OWNER,
      'garage',
      access('draft'),
    );

    expect(element.textContent).toContain('Profilul tău e în verificare.');
    expect(element.textContent).not.toContain(
      'Aici vei vedea ce se întâmplă azi în service.',
    );
    await harness.navigateByUrl('/app/garage/prices');
    expect(harness.routeNativeElement?.textContent).toContain(
      'Aici vei vedea intervalele de preț pe lucrări.',
    );
    expect(harness.routeNativeElement?.textContent).not.toContain(
      'Profilul tău e în verificare.',
    );
  });

  // @traces 097-FR-006 097-FR-008
  it('shows the empty state, not the check line, when the session’s garage matches no membership', async () => {
    requestList = () => Promise.reject(new HttpErrorResponse({ status: 404 }));
    const { element, harness } = await open('/app/garage', OWNER, 'garage', [
      { ...access('draft')[0], garageId: 'another-garage' },
    ]);
    // The requests' first read answers 404 a moment later.
    for (let i = 0; i < 4; i++) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      await harness.fixture.whenStable();
      harness.detectChanges();
    }

    expect(element.textContent).toContain(
      'Aici vei vedea ce se întâmplă azi în service.',
    );
    expect(element.textContent).not.toContain('Profilul tău e în verificare.');
  });

  it('opens the released garages view for an admin', async () => {
    await open('/app/admin/garages', ADMIN, 'admin');

    expect(TestBed.inject(Router).url).toBe('/app/admin/garages');
  });
});
