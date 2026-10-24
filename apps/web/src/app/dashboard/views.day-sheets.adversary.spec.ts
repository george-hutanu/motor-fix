import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { CanMatchFn } from '@angular/router';
import type { MeDto } from '@motor-fix/data-access';

import { Session } from './session';
import { allowedViews, DASHBOARDS, dashboardRoutes } from './views';

const OWNER_CAPS = [
  'garage.requests',
  'garage.schedule',
  'garage.own_jobs',
  'garage.team',
  'garage.prices',
  'garage.reviews',
  'garage.profile',
  'garage.audit_history',
];

const me = (features: Record<string, unknown>, garageId = 'g-1') =>
  ({
    capabilities: OWNER_CAPS,
    garageAccess: [
      {
        features,
        garageId: 'g-1',
        name: 'Atelier',
        permissions: {},
        role: 'owner',
        status: 'approved',
      },
    ],
    garageId,
  }) as unknown as MeDto;

const paths = (features: Record<string, boolean>, caps = OWNER_CAPS) =>
  allowedViews('garage', caps, features).map((v) => v.path);

const matches = (path: string, current: MeDto | null) => {
  TestBed.configureTestingModule({
    providers: [{ provide: Session, useValue: { current: signal(current) } }],
  });
  const route = dashboardRoutes('garage').find((r) => r.path === path);
  const guard = route?.canMatch?.[0] as CanMatchFn;
  return TestBed.runInInjectionContext(() =>
    guard(route as never, [], {} as never),
  );
};

describe('the schedule view and the day-sheets switch under odd input', () => {
  afterEach(() => TestBed.resetTestingModule());

  // @traces 531-FR-001
  it('hides the schedule only when day_sheets is exactly false', () => {
    expect(paths({ day_sheets: false })).not.toContain('schedule');
    expect(paths({ day_sheets: true })).toContain('schedule');
    expect(paths({})).toContain('schedule');
    expect(paths({ team_mechanics: false })).toContain('schedule');
    expect(paths({ Day_Sheets: false })).toContain('schedule');
    expect(paths({ ' day_sheets': false })).toContain('schedule');
  });

  // @traces 531-FR-001
  it.each([null, 0, '', 'false', undefined])(
    'keeps the schedule when day_sheets is the non-boolean %j',
    (value) => {
      const features = { day_sheets: value } as unknown as Record<
        string,
        boolean
      >;
      expect(paths(features)).toContain('schedule');
    },
  );

  // @traces 531-FR-001
  it('removes only the schedule when day_sheets is off', () => {
    const all = paths({});
    expect(paths({ day_sheets: false })).toEqual(
      all.filter((p) => p !== 'schedule'),
    );
  });

  // @traces 531-FR-001
  it('removes only the schedule and the team when every switch is off', () => {
    const off = {
      day_sheets: false,
      lift_schedule: false,
      live_media: false,
      team_mechanics: false,
      whatsapp: false,
    };
    expect(paths(off)).toEqual(
      paths({}).filter((p) => p !== 'schedule' && p !== 'team'),
    );
  });

  // @traces 531-FR-001
  it('gives no other view a feature', () => {
    const withFeature = DASHBOARDS.garage.views
      .filter((v) => v.feature)
      .map((v) => [v.path, v.feature]);
    expect(withFeature).toEqual([
      ['schedule', 'day_sheets'],
      ['team', 'team_mechanics'],
    ]);
    expect(
      [...DASHBOARDS.driver.views, ...DASHBOARDS.admin.views].filter(
        (v) => v.feature,
      ),
    ).toEqual([]);
  });

  // @traces 531-FR-001
  it('leaves the driver and admin lists alone when day_sheets is off', () => {
    const caps = ['driver.cars', 'admin.overview'];
    for (const area of ['driver', 'admin'] as const) {
      expect(
        allowedViews(area, caps, { day_sheets: false }).map((v) => v.path),
      ).toEqual(allowedViews(area, caps, {}).map((v) => v.path));
    }
  });

  // @traces 531-FR-001
  it('does not list the schedule for a member without its capability even with the switch on', () => {
    expect(
      paths(
        { day_sheets: true },
        OWNER_CAPS.filter((c) => c !== 'garage.schedule'),
      ),
    ).not.toContain('schedule');
  });

  // @traces 531-FR-001
  it('refuses the schedule route with the switch off and lets it through when on or unset', () => {
    expect(matches('schedule', me({ day_sheets: false }))).toBe(false);
    TestBed.resetTestingModule();
    expect(matches('schedule', me({ day_sheets: true }))).toBe(true);
    TestBed.resetTestingModule();
    expect(matches('schedule', me({}))).toBe(true);
  });

  // @traces 531-FR-001
  it('judges the schedule route by the session garage, not another entry', () => {
    const current = me({ day_sheets: false });
    current.garageAccess.push({
      ...current.garageAccess[0],
      features: {},
      garageId: 'g-2',
    });
    expect(matches('schedule', current)).toBe(false);
  });

  // @traces 531-FR-001
  it('lets the schedule route through when the session garage matches no entry', () => {
    expect(matches('schedule', me({ day_sheets: false }, 'other'))).toBe(true);
  });

  // @traces 531-FR-001
  it('survives a prototype-polluting day_sheets key', () => {
    const features = JSON.parse(
      '{"__proto__": {"day_sheets": false}}',
    ) as Record<string, boolean>;
    expect(paths(features)).toContain('schedule');
  });

  // @traces 531-FR-001
  it('shows the schedule again when the same list is asked after a switch-on', () => {
    expect(paths({ day_sheets: false })).not.toContain('schedule');
    expect(paths({ day_sheets: true })).toContain('schedule');
    expect(paths({ day_sheets: false })).not.toContain('schedule');
  });

  // @traces 531-FR-001
  it('shows nothing for a draft garage whatever the switch', () => {
    expect(allowedViews('garage', OWNER_CAPS, {}, 'draft')).toEqual([]);
  });
});
