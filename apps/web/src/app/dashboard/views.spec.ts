import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router, RouterOutlet } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { type MeDto, NotificationsService } from '@motor-fix/data-access';
import { Subject } from 'rxjs';

import { Live } from './live';
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

const paths = (area: 'driver' | 'garage' | 'admin', capabilities: string[]) =>
  allowedViews(area, capabilities).map((view) => view.path);

describe('the dashboard view lists', () => {
  it('lists the driver views in menu order, each with its address, labels and capability', () => {
    expect(DASHBOARDS.driver.views).toEqual([
      {
        label: 'shell.frame.nav.dashboard',
        path: '',
        tab: 'shell.frame.tab.dashboard',
      },
      {
        capability: 'driver.requests',
        label: 'shell.frame.nav.driver.requests',
        path: 'requests',
        tab: 'shell.frame.tab.requests',
      },
      {
        capability: 'driver.cars',
        label: 'shell.frame.nav.driver.cars',
        path: 'cars',
        tab: 'shell.frame.tab.cars',
      },
      {
        capability: 'driver.reviews',
        label: 'shell.frame.nav.driver.reviews',
        path: 'reviews',
        tab: 'shell.frame.tab.reviews',
      },
      {
        capability: 'driver.saved_garages',
        label: 'shell.frame.nav.driver.savedGarages',
        path: 'saved',
        tab: 'shell.frame.tab.saved',
      },
      {
        capability: 'driver.settings',
        label: 'shell.frame.nav.driver.settings',
        path: 'settings',
        push: true,
        tab: 'shell.frame.tab.settings',
      },
    ]);
  });

  it('gives the garage and admin dashboards their addresses in menu order', () => {
    expect(DASHBOARDS.garage.views.map((view) => view.path)).toEqual([
      '',
      'requests',
      'schedule',
      'team',
      'prices',
      'reviews',
      'profile',
      'settings',
    ]);
    expect(DASHBOARDS.admin.views.map((view) => view.path)).toEqual([
      '',
      'garages',
      'users',
      'reviews',
      'catalogue',
      'settings',
    ]);
  });

  it('names each dashboard for its bar and tags it for its menu', () => {
    expect(DASHBOARDS.driver.name).toBe('shell.frame.bar.driver');
    expect(DASHBOARDS.garage.name).toBe('shell.frame.bar.garage');
    expect(DASHBOARDS.admin.name).toBe('shell.frame.bar.admin');
    expect(DASHBOARDS.garage.tag).toBe('shell.frame.area.garage');
  });

  it('gives a garage owner every garage view', () => {
    expect(paths('garage', OWNER)).toEqual([
      '',
      'requests',
      'schedule',
      'team',
      'prices',
      'reviews',
      'profile',
      'settings',
    ]);
  });

  it('keeps the team, the prices and the garage profile from a receptionist', () => {
    expect(paths('garage', RECEPTIONIST)).toEqual([
      '',
      'requests',
      'schedule',
      'settings',
    ]);
  });

  it('gives a mechanic the dashboard view, the settings and what their permissions allow', () => {
    expect(
      paths('garage', ['garage.own_jobs', 'garage.audit_history']),
    ).toEqual(['', 'settings']);
    expect(
      paths('garage', [
        'garage.own_jobs',
        'garage.audit_history',
        'garage.requests',
        'garage.schedule',
      ]),
    ).toEqual(['', 'requests', 'schedule', 'settings']);
  });

  // @traces 198-FR-011
  it('gives the garage a settings view with no capability, carrying the push and staff panels', () => {
    expect(DASHBOARDS.garage.views.at(-1)).toEqual({
      label: 'shell.frame.nav.garage.settings',
      path: 'settings',
      push: true,
      staff: true,
      tab: 'shell.frame.tab.settings',
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

  it('gives an admin every admin view', () => {
    expect(
      paths('admin', [
        'admin.garages',
        'admin.users',
        'admin.reviews',
        'admin.catalogue',
        'admin.settings',
        'admin.audit_history',
      ]),
    ).toEqual(['', 'garages', 'users', 'reviews', 'catalogue', 'settings']);
  });
});

@Component({ imports: [RouterOutlet], template: '<router-outlet />' })
class Shell {}

async function open(url: string, capabilities: string[]) {
  const current = signal({ capabilities } as unknown as MeDto);
  TestBed.configureTestingModule({
    providers: [
      provideRouter([
        {
          children: dashboardRoutes('garage'),
          component: Shell,
          path: 'app/garage',
        },
      ]),
      { provide: Session, useValue: { current } },
      {
        provide: NotificationsService,
        useValue: {
          notificationPreferencesControllerRead: async () => ({ staff: [] }),
        },
      },
      {
        provide: Live,
        useValue: { events: new Subject(), resync: new Subject() },
      },
    ],
  });
  const harness = await RouterTestingHarness.create();
  await harness.navigateByUrl(url);
  return { element: harness.routeNativeElement as HTMLElement, harness };
}

describe('the dashboard view routes', () => {
  it('opens an allowed view at its own address, with a placeholder body', async () => {
    const { element } = await open('/app/garage/team', OWNER);

    expect(TestBed.inject(Router).url).toBe('/app/garage/team');
    expect(element.textContent).toContain('Nimic aici încă.');
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
});
