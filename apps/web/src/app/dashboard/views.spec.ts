import { HttpErrorResponse } from '@angular/common/http';
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router, RouterOutlet } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { capabilitiesOf } from '@motor-fix/contracts/capabilities';
import {
  CarsService,
  GarageRequestsService,
  GaragesService,
  type MeDto,
  NotificationsService,
  PlacesService,
  SavedGaragesService,
} from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';
import { NEVER, Subject } from 'rxjs';

import { AdminDemand } from './admin-demand/admin-demand';
import { AdminLogView } from './admin-log-view/admin-log-view';
import { AdminOverview } from './admin-overview';
import { AdminPanel } from './admin-panel/admin-panel';
import { AdminProposedJobs } from './admin-proposed-jobs/admin-proposed-jobs';
import { AdminReviews } from './admin-reviews/admin-reviews';
import { AdminUsers } from './admin-users/admin-users';
import { CarsView } from './cars-view/cars-view';
import { DriverHome } from './driver-home/driver-home';
import { DriverSettingsView } from './driver-settings-view/driver-settings-view';
import { GarageHome } from './garage-requests/garage-home/garage-home';
import { GarageRequestsFeed } from './garage-requests/garage-requests-feed';
import { GarageRequestsView } from './garage-requests/garage-requests-view/garage-requests-view';
import { GarageReviewsPanel } from './garage-reviews/garage-reviews-panel/garage-reviews-panel';
import { JobsView } from './jobs-view/jobs-view';
import { Live } from './live';
import { PricesView } from './prices-view/prices-view';
import { ProfileView } from './profile-view/profile-view';
import { RequestsView } from './requests-view/requests-view';
import {
  fakeSavedGarages,
  pageOf,
} from './saved-garages/saved-garages.testing';
import { Session } from './session';
import { allowedViews, DASHBOARDS, dashboardRoutes } from './views';
import { SavedGarages } from '../public/saved-garages/saved-garages';

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
const NO_PERMISSIONS = {
  canAnswerQuotes: false,
  canMoveBookings: false,
  canRecordFinalPrice: false,
};
// The receptionist's and the mechanic's rows, read from the table itself.
const RECEPTIONIST = capabilitiesOf('receptionist', NO_PERMISSIONS);
const MECHANIC = capabilitiesOf('mechanic', NO_PERMISSIONS);

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
  // @traces 030-FR-009 030-FR-011
  it('gives the driver reviews and saved garages their own empty state', () => {
    const byPath = (path: string) =>
      DASHBOARDS.driver.views.find((view) => view.path === path);

    expect(byPath('reviews')?.emptyState).toEqual({
      icon: 'star',
      text: 'driver.empty.reviews',
    });
    // The saved garages' view draws its own empty state.
    expect(byPath('saved')?.emptyState).toBeUndefined();
    expect(byPath('saved')?.load).toEqual(expect.any(Function));
    expect(byPath('saved')?.capability).toBe('driver.saved_garages');
  });

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
        emptyState: { icon: 'star', text: 'driver.empty.reviews' },
        label: 'shell.frame.nav.driver.reviews',
        path: 'reviews',
        tab: 'shell.frame.tab.reviews',
        title: 'shell.frame.title.driver.reviews',
      },
      {
        capability: 'driver.saved_garages',
        label: 'shell.frame.nav.driver.savedGarages',
        load: expect.any(Function),
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
        capability: 'driver.settings',
        label: 'shell.frame.nav.driver.settings',
        load: expect.any(Function),
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

  // @traces 139-FR-001
  // The driver's Setări carries the details form and its three dialogs; it
  // loads with its view, so the first page stays under the budget.
  it("loads the driver's settings only when their view opens", async () => {
    const settings = DASHBOARDS.driver.views.find((v) => v.path === 'settings');

    expect(settings?.body).toBeUndefined();
    await expect(settings?.load?.()).resolves.toBe(DriverSettingsView);
  });

  // @traces 163-FR-008
  // The admin Panou carries the figures' choice; it loads with its view, so
  // the first page any visitor opens stays inside the initial bundle budget.
  it('loads the admin Panou only when its view opens', async () => {
    const [home] = DASHBOARDS.admin.views;

    expect(home.body).toBeUndefined();
    expect(await home.load?.()).toBe(AdminPanel);
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

  // @traces 074-FR-002
  it('loads the reviews panel as the garage Recenzii view', async () => {
    const reviews = DASHBOARDS.garage.views.find(
      (view) => view.path === 'reviews',
    );

    expect(reviews?.capability).toBe('garage.reviews');
    expect(await reviews?.load?.()).toBe(GarageReviewsPanel);
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
      'proposed-jobs',
      'assistant',
      'log',
      'settings',
    ]);
  });

  // @traces 1389-FR-001
  it('loads the reported reviews list as the admin Recenzii raportate view', async () => {
    const reviews = DASHBOARDS.admin.views.find(
      (view) => view.path === 'reviews',
    );

    expect(await reviews?.load?.()).toBe(AdminReviews);
  });

  it('lists the admin views with their labels, capabilities, release marks and counter', () => {
    expect(DASHBOARDS.admin.views).toEqual([
      {
        label: 'shell.frame.nav.dashboard',
        load: expect.any(Function),
        path: '',
        tab: 'shell.frame.tab.overview',
      },
      {
        capability: 'admin.garages',
        counter: 'garagesWaiting',
        label: 'shell.frame.nav.admin.garages',
        load: expect.any(Function),
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
        counter: 'reportsPending',
        label: 'shell.frame.nav.admin.reviews',
        load: expect.any(Function),
        path: 'reviews',
        tab: 'shell.frame.tab.reported',
      },
      {
        capability: 'admin.catalogue',
        label: 'shell.frame.nav.admin.catalogue',
        load: expect.any(Function),
        path: 'catalogue',
        tab: 'shell.frame.tab.brands',
      },
      {
        capability: 'admin.catalogue',
        label: 'shell.frame.nav.admin.proposedJobs',
        load: expect.any(Function),
        path: 'proposed-jobs',
        tab: 'shell.frame.tab.proposed',
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
        label: 'shell.frame.nav.admin.log',
        load: expect.any(Function),
        path: 'log',
        tab: 'shell.frame.tab.log',
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

  // @traces 299-FR-006
  it('downloads the system log view when it is opened, not with the first page', async () => {
    const log = DASHBOARDS.admin.views.find((view) => view.path === 'log');

    await expect(log?.load?.()).resolves.toBe(AdminLogView);
  });

  it('downloads the admin users view when it is opened, not with the first page', async () => {
    const users = DASHBOARDS.admin.views.find((view) => view.path === 'users');

    await expect(users?.load?.()).resolves.toBe(AdminUsers);
  });

  // @traces 414-FR-011
  it('downloads the proposed jobs view when it is opened, not with the first page', async () => {
    const proposed = DASHBOARDS.admin.views.find(
      (view) => view.path === 'proposed-jobs',
    );

    await expect(proposed?.load?.()).resolves.toBe(AdminProposedJobs);
  });

  // @traces 103-FR-006
  it('downloads the brands and jobs view when it is opened, not with the first page', async () => {
    const brands = DASHBOARDS.admin.views.find(
      (view) => view.path === 'catalogue',
    );

    await expect(brands?.load?.()).resolves.toBe(AdminDemand);
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

  // @traces 102-FR-004
  it('keeps the team and the prices from a receptionist, and gives her the reviews and the garage profile', () => {
    expect(paths('garage', RECEPTIONIST)).toEqual([
      '',
      'requests',
      'schedule',
      'jobs',
      'reviews',
      'profile',
      'settings',
      'history',
    ]);
  });

  // @traces 172-FR-001 172-FR-009
  // @traces 1315-FR-012
  it('gives the owner alone the prices view, its body downloaded with the view', async () => {
    const prices = DASHBOARDS.garage.views.find(
      (view) => view.path === 'prices',
    );
    expect(prices?.capability).toBe('garage.prices');
    await expect(prices?.load?.()).resolves.toBe(PricesView);
    const route = dashboardRoutes('garage').find((r) => r.path === 'prices');
    await expect(route?.children?.[0].loadComponent?.()).resolves.toBe(
      PricesView,
    );
    expect(paths('garage', OWNER)).toContain('prices');
    expect(paths('garage', RECEPTIONIST)).not.toContain('prices');
    expect(
      paths('garage', ['garage.own_jobs', 'garage.audit_history']),
    ).not.toContain('prices');
  });

  // @traces 133-FR-002 133-FR-005
  // @traces 102-FR-004
  it('gives the owner and the receptionist the garage profile view, its body downloaded with the view', async () => {
    const profile = DASHBOARDS.garage.views.find(
      (view) => view.path === 'profile',
    );
    expect(profile?.capability).toBe('garage.profile');
    await expect(profile?.load?.()).resolves.toBe(ProfileView);
    const route = dashboardRoutes('garage').find((r) => r.path === 'profile');
    await expect(route?.children?.[0].loadComponent?.()).resolves.toBe(
      ProfileView,
    );
    expect(paths('garage', OWNER)).toContain('profile');
    expect(paths('garage', RECEPTIONIST)).toContain('profile');
    expect(paths('garage', MECHANIC)).not.toContain('profile');
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
    ).toEqual([
      '',
      'garages',
      'users',
      'reviews',
      'catalogue',
      'proposed-jobs',
      'log',
      'settings',
    ]);
  });

  // @traces 1389-FR-001
  it('opens the reported reviews view to an admin who holds its permission only', () => {
    expect(paths('admin', ['admin.reviews'])).toEqual(['', 'reviews']);
    expect(paths('admin', [])).toEqual(['']);
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
  it('gives every garage view a title, every one but Panou a subtitle, and every one but Panou and Setări an empty state, in both languages', async () => {
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
      '',
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

  // @traces 531-FR-001
  it('drops Programări while the garage has day sheets off, and keeps it while they are on or unknown', () => {
    const shown = (features: Record<string, boolean>) =>
      allowedViews('garage', OWNER, features).map((v) => v.path);

    expect(shown({ day_sheets: false })).not.toContain('schedule');
    expect(shown({ day_sheets: false })).toEqual(
      paths('garage', OWNER).filter((path) => path !== 'schedule'),
    );
    expect(shown({ day_sheets: true })).toContain('schedule');
    expect(shown({})).toContain('schedule');
    expect(shown({ day_sheets: false, team_mechanics: false })).toEqual(
      paths('garage', OWNER).filter(
        (path) => path !== 'schedule' && path !== 'team',
      ),
    );
  });

  it('ties Programări to day sheets and Mecanici to the team, and no other garage view to a switch', () => {
    expect(
      Object.fromEntries(
        DASHBOARDS.garage.views
          .filter((view) => view.feature)
          .map((view) => [view.path, view.feature]),
      ),
    ).toEqual({ schedule: 'day_sheets', team: 'team_mechanics' });
  });

  // @traces 101-FR-007
  it('opens no garage view while the garage is a draft, and every allowed one once it is approved or suspended', () => {
    expect(allowedViews('garage', OWNER, {}, 'draft')).toEqual([]);
    for (const status of ['approved', 'suspended'] as const) {
      expect(
        allowedViews('garage', OWNER, {}, status).map((v) => v.path),
      ).toEqual(paths('garage', OWNER));
    }
    expect(allowedViews('garage', OWNER, {}).map((v) => v.path)).toEqual(
      paths('garage', OWNER),
    );
    expect(
      allowedViews('driver', ['driver.reviews'], {}, 'draft').length,
    ).toBeGreaterThan(0);
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
        provide: GaragesService,
        useValue: {
          verificationStatusControllerRead: () => new Promise(() => undefined),
        },
      },
      {
        provide: AdminOverview,
        useValue: {
          city: signal('all'),
          failed: signal(false),
          figures: signal(undefined),
          figuresLoading: signal(false),
          loading: signal(true),
          overdue: signal(undefined),
          pending: signal(undefined),
          period: signal('default'),
        },
      },
      {
        provide: SavedGaragesService,
        useValue: { savedGaragesControllerList: async () => pageOf([]) },
      },
      { provide: SavedGarages, useValue: fakeSavedGarages() },
      {
        provide: CarsService,
        useValue: {
          carsControllerList: async () => ({
            items: [],
            nextCursor: null,
            total: 0,
          }),
        },
      },
      {
        provide: PlacesService,
        useValue: { placesControllerSearch: async () => ({ items: [] }) },
      },
    ],
  });
  const harness = await RouterTestingHarness.create();
  await harness.navigateByUrl(url);
  // A view's own texts load in the turns after it opens.
  for (let i = 0; i < 3; i++) {
    await new Promise((resolve) => setTimeout(resolve));
    harness.detectChanges();
  }
  return { element: harness.routeNativeElement as HTMLElement, harness };
}

// @traces 102-FR-003
// @traces 102-FR-004
describe('the garage menu of each role, read from the table', () => {
  const menu = (
    capabilities: readonly string[],
    features: Record<string, boolean> = {},
  ) => allowedViews('garage', capabilities, features).map((view) => view.path);
  const mechanic = (permissions: Partial<typeof NO_PERMISSIONS>) =>
    capabilitiesOf('mechanic', { ...NO_PERMISSIONS, ...permissions });

  it('gives a mechanic without permissions Panou, Lucrări, Programări, Setări and Istoric modificări', () => {
    expect(menu(MECHANIC)).toEqual([
      '',
      'schedule',
      'jobs',
      'settings',
      'history',
    ]);
  });

  it('adds Cereri de ofertă to a mechanic who may answer quotes, and nothing for the other permissions', () => {
    expect(menu(mechanic({ canAnswerQuotes: true }))).toEqual([
      '',
      'requests',
      'schedule',
      'jobs',
      'settings',
      'history',
    ]);
    expect(
      menu(mechanic({ canMoveBookings: true, canRecordFinalPrice: true })),
    ).toEqual(menu(MECHANIC));
  });

  it('gives the receptionist no Mecanici and no Prețuri', () => {
    expect(menu(RECEPTIONIST)).not.toContain('team');
    expect(menu(RECEPTIONIST)).not.toContain('prices');
  });

  it('gives the owner every released garage view', () => {
    expect(menu(capabilitiesOf('garage', NO_PERMISSIONS))).toEqual(
      DASHBOARDS.garage.views
        .filter((view) => !view.unreleased)
        .map((view) => view.path),
    );
  });

  it('removes a switched-off view for every role before the role row is read', () => {
    for (const capabilities of [
      capabilitiesOf('garage', NO_PERMISSIONS),
      RECEPTIONIST,
      MECHANIC,
    ]) {
      expect(menu(capabilities, { day_sheets: false })).not.toContain(
        'schedule',
      );
      expect(menu(capabilities, { team_mechanics: false })).not.toContain(
        'team',
      );
    }
  });
});

describe('the dashboard view routes', () => {
  // @traces 097-FR-004
  it('opens an allowed view at its own address, with the empty state of that view', async () => {
    const { element } = await open('/app/garage/schedule', OWNER);

    expect(TestBed.inject(Router).url).toBe('/app/garage/schedule');
    expect(element.textContent).toContain(
      'Aici vei vedea programările pe zile, pe mecanici și pe elevatoare.',
    );
    expect(element.textContent).not.toContain('Nimic aici încă.');
  });

  // @traces 030-FR-009
  it('opens the driver reviews with their own empty state, not the shared placeholder', async () => {
    const { element } = await open(
      '/app/driver/reviews',
      ['driver.reviews'],
      'driver',
    );

    expect(element.textContent).toContain(
      'Nicio recenzie încă. După o reparație prin MotorFix îți cerem părerea.',
    );
    expect(element.textContent).not.toContain('Nimic aici încă.');
  });

  // @traces 030-FR-011
  it('opens the saved garages with their own empty state only for a driver who may', async () => {
    const { element } = await open(
      '/app/driver/saved',
      ['driver.saved_garages'],
      'driver',
    );

    expect(TestBed.inject(Router).url).toBe('/app/driver/saved');
    expect(element.textContent).toContain('Nu ai salvat încă niciun service.');
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

  it.each(['assistant'])(
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
      expect(element.querySelector('mf-verification-progress')).toBeNull();
    }
  });

  // @traces 097-FR-008 101-FR-001 101-FR-007
  it('shows a draft garage’s verification page on its dashboard, and sends every view back to it', async () => {
    const { element, harness } = await open(
      '/app/garage',
      OWNER,
      'garage',
      access('draft'),
    );

    expect(element.querySelector('mf-verification-progress')).not.toBeNull();
    expect(element.querySelector('mf-garage-requests-panel')).toBeNull();
    expect(element.textContent).not.toContain(
      'Aici vei vedea ce se întâmplă azi în service.',
    );
    for (const view of ['requests', 'reviews', 'team']) {
      await harness.navigateByUrl(`/app/garage/${view}`);
      expect(TestBed.inject(Router).url).toBe('/app/garage');
      expect(
        harness.routeNativeElement?.querySelector('mf-verification-progress'),
      ).not.toBeNull();
    }
  });

  // @traces 097-FR-006 097-FR-008
  // @traces 099-FR-006
  it('shows no section and no check line when the session’s garage matches no membership', async () => {
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

    expect(element.querySelector('[data-section]')).toBeNull();
    expect(element.querySelector('[data-verified-pill]')).toBeNull();
    expect(element.querySelector('mf-verification-progress')).toBeNull();
  });

  it('opens the released garages view for an admin', async () => {
    await open('/app/admin/garages', ADMIN, 'admin');

    expect(TestBed.inject(Router).url).toBe('/app/admin/garages');
  });
});
