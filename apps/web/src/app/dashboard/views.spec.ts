import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router, RouterOutlet } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import type { MeDto } from '@motor-fix/data-access';

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
    expect(DASHBOARDS.driver.name).toBe('shell.frame.tabs.driver');
    expect(DASHBOARDS.garage.name).toBe('shell.frame.tabs.garage');
    expect(DASHBOARDS.admin.name).toBe('shell.frame.tabs.admin');
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
    ]);
  });

  it('keeps the team, the prices and the garage profile from a receptionist', () => {
    expect(paths('garage', RECEPTIONIST)).toEqual(['', 'requests', 'schedule']);
  });

  it('gives a mechanic the dashboard view plus what their permissions allow', () => {
    expect(
      paths('garage', ['garage.own_jobs', 'garage.audit_history']),
    ).toEqual(['']);
    expect(
      paths('garage', [
        'garage.own_jobs',
        'garage.audit_history',
        'garage.requests',
        'garage.schedule',
      ]),
    ).toEqual(['', 'requests', 'schedule']);
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

  it('sends an unknown view address to the dashboard', async () => {
    await open('/app/garage/nope', OWNER);

    expect(TestBed.inject(Router).url).toBe('/app/garage');
  });
});
