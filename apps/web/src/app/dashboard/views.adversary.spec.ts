import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import type { MeDto } from '@motor-fix/data-access';
import { Subject } from 'rxjs';

import { Frame } from './frame';
import { Live } from './live';
import { Session } from './session';
import { type Area, allowedViews, DASHBOARDS, dashboardRoutes } from './views';

const AREAS: Area[] = ['driver', 'garage', 'admin'];

const me = (landing: string, capabilities: string[]) =>
  ({
    capabilities,
    email: null,
    garageId: null,
    id: 'a',
    landing,
    language: 'ro',
    name: 'X',
    role: 'x',
    roles: ['x'],
  }) as unknown as MeDto;

async function open(capabilities: string[] | null, area: Area, url: string) {
  Element.prototype.scrollIntoView = jest.fn();
  const current = signal<MeDto | null>(
    capabilities ? me(`/app/${area}`, capabilities) : null,
  );
  TestBed.configureTestingModule({
    providers: [
      provideRouter(
        AREAS.map((a) => ({
          children: dashboardRoutes(a),
          component: Frame,
          path: `app/${a}`,
        })),
      ),
      {
        provide: Session,
        useValue: {
          current,
          ended: new Subject<void>(),
          shown: current,
          signOut: jest.fn(),
        },
      },
      {
        provide: Live,
        useValue: {
          close: jest.fn(),
          events: new Subject(),
          offline: signal(false),
          open: jest.fn(),
          resync: new Subject(),
        },
      },
    ],
  });
  const harness = await RouterTestingHarness.create();
  await harness.navigateByUrl(url);
  harness.detectChanges();
  await harness.fixture.whenStable();
  harness.detectChanges();
  return {
    current,
    element: harness.fixture.nativeElement as HTMLElement,
    harness,
    url: () => TestBed.inject(Router).url,
  };
}

const ALL = AREAS.flatMap((a) =>
  DASHBOARDS[a].views.flatMap((v) => (v.capability ? [v.capability] : [])),
);

describe('dashboard view lists under hostile input', () => {
  it('has unique paths and unique capabilities in every dashboard', () => {
    for (const area of AREAS) {
      const paths = DASHBOARDS[area].views.map((v) => v.path);
      const caps = DASHBOARDS[area].views
        .map((v) => v.capability)
        .filter(Boolean);
      expect(new Set(paths).size).toBe(paths.length);
      expect(new Set(caps).size).toBe(caps.length);
    }
  });

  it('starts every dashboard with the capability-free dashboard view at the empty path', () => {
    for (const area of AREAS) {
      expect(DASHBOARDS[area].views[0]).toMatchObject({ path: '' });
      expect(DASHBOARDS[area].views[0].capability).toBeUndefined();
    }
  });

  it('keeps only the capability-free views for an empty capability list', () => {
    expect(allowedViews('driver', []).map((v) => v.path)).toEqual(['']);
    expect(allowedViews('admin', []).map((v) => v.path)).toEqual(['']);
    expect(allowedViews('garage', []).map((v) => v.path)).toEqual([
      '',
      'settings',
    ]);
  });

  it('ignores capabilities of other dashboards', () => {
    expect(
      allowedViews(
        'driver',
        ALL.filter((c) => !c.startsWith('driver.')),
      ).map((v) => v.path),
    ).toEqual(['']);
    expect(
      allowedViews(
        'admin',
        ALL.filter((c) => c.startsWith('garage.')),
      ).map((v) => v.path),
    ).toEqual(['']);
  });

  it('matches capabilities exactly, not by prefix, case or whitespace', () => {
    expect(
      allowedViews('garage', [
        'garage.team ',
        'Garage.team',
        'garage.tea',
        'garage.team.x',
        'garage',
      ]).map((v) => v.path),
    ).toEqual(['', 'settings']);
  });

  it('does not mutate the capabilities it is given nor the shared list', () => {
    const caps = Object.freeze(['garage.team']) as readonly string[];
    const before = DASHBOARDS.garage.views.length;
    const first = allowedViews('garage', caps);
    first.pop();
    expect(allowedViews('garage', caps).map((v) => v.path)).toEqual([
      '',
      'team',
      'settings',
    ]);
    expect(DASHBOARDS.garage.views.length).toBe(before);
  });

  it('keeps list order whatever the order of the capabilities', () => {
    expect(
      allowedViews('garage', ['garage.profile', 'garage.requests']).map(
        (v) => v.path,
      ),
    ).toEqual(['', 'requests', 'profile', 'settings']);
  });

  it('gives every view a distinct short and long label key', () => {
    for (const area of AREAS) {
      const views = DASHBOARDS[area].views;
      expect(new Set(views.map((v) => v.tab)).size).toBe(views.length);
      expect(new Set(views.map((v) => v.label)).size).toBe(views.length);
    }
  });

  it('builds one route per view plus a catch-all redirect that is last', () => {
    for (const area of AREAS) {
      const routes = dashboardRoutes(area);
      expect(routes).toHaveLength(DASHBOARDS[area].views.length + 1);
      expect(routes[routes.length - 1]).toEqual({
        path: '**',
        redirectTo: '',
      });
    }
  });
});

describe('dashboard routing under hostile addresses', () => {
  const lands = [
    ['an unknown segment', '/app/driver/nope'],
    ['a refused view', '/app/garage/team'],
    ['a refused view sub-path', '/app/garage/team/42/edit'],
    ['a refused view with a query', '/app/garage/prices?x=1'],
    ['another dashboard segment', '/app/driver/garages'],
    ['an upper-case view segment', '/app/garage/REQUESTS'],
    ['a prefix of a real view', '/app/garage/requestsfoo'],
    ['a deep unknown path', '/app/garage/a/b/c/d'],
    ['an encoded dot segment', '/app/garage/%2e%2e'],
  ] as const;

  it.each(lands)('sends %s to the dashboard view', async (_n, address) => {
    const area = address.split('/')[2] as Area;
    const { url, element } = await open([], area, address);
    // The query string is kept: only the path is the dashboard's own.
    expect(url().split('?')[0]).toBe(`/app/${area}`);
    expect(element.querySelector('h1')?.textContent?.trim()).toBe('Panou');
  });

  it('keeps an allowed view address and its sub-path', async () => {
    const { url } = await open(['garage.team'], 'garage', '/app/garage/team/7');
    expect(url()).toBe('/app/garage/team/7');
  });

  it('keeps the dashboard view for a trailing slash', async () => {
    const { url } = await open([], 'admin', '/app/admin/');
    expect(url()).toBe('/app/admin');
  });

  it('does not let a garage capability open a driver view of the same name', async () => {
    const { url } = await open(
      ['garage.reviews'],
      'driver',
      '/app/driver/reviews',
    );
    expect(url()).toBe('/app/driver');
  });

  it('redirects to the dashboard view when the session is empty', async () => {
    const { url } = await open(null, 'garage', '/app/garage/requests');
    expect(url()).toBe('/app/garage');
  });

  it('marks only the open view current in the bar and the menu', async () => {
    const { element } = await open(
      ['garage.requests', 'garage.reviews'],
      'garage',
      '/app/garage/reviews',
    );
    const mark = (sel: string) =>
      [...element.querySelectorAll(sel)].map((a) => a.textContent?.trim());
    expect(mark('mf-dashboard-tab-bar nav a[aria-current]')).toEqual([
      'Recenzii',
    ]);
    expect(mark('aside nav a[aria-current]')).toEqual(['Recenzii']);
  });

  it('marks the tab and menu entry current on a sub-path of the view', async () => {
    const { element } = await open(
      ['garage.team'],
      'garage',
      '/app/garage/team/9',
    );
    const mark = (sel: string) =>
      [...element.querySelectorAll(sel)].map((a) => a.textContent?.trim());
    expect(mark('mf-dashboard-tab-bar nav a[aria-current="page"]')).toEqual([
      'Mecanici',
    ]);
    expect(mark('aside nav a[aria-current="page"]')).toEqual(['Mecanici']);
  });

  it('moves a person off a view when a capability is removed mid-session', async () => {
    const { current, harness, url } = await open(
      ['garage.team'],
      'garage',
      '/app/garage/team',
    );
    current.set(me('/app/garage', []));
    harness.detectChanges();
    await harness.fixture.whenStable();
    harness.detectChanges();
    expect(url()).toBe('/app/garage');
  });

  it('shows no refused tab after the capabilities shrink', async () => {
    const { current, harness, element } = await open(
      ['garage.team', 'garage.prices'],
      'garage',
      '/app/garage',
    );
    current.set(me('/app/garage', ['garage.prices']));
    harness.detectChanges();
    await harness.fixture.whenStable();
    harness.detectChanges();
    expect(
      [...element.querySelectorAll('mf-dashboard-tab-bar nav a')].map((a) =>
        a.textContent?.trim(),
      ),
    ).toEqual(['Panou', 'Prețuri', 'Setări']);
  });
});
