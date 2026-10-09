import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { CanMatchFn } from '@angular/router';
import type { MeDto } from '@motor-fix/data-access';

import { garageOf, Session } from './session';
import { allowedViews, DASHBOARDS, dashboardRoutes } from './views';

const OWNER_CAPS = [
  'garage.requests',
  'garage.schedule',
  'garage.team',
  'garage.prices',
  'garage.reviews',
  'garage.profile',
  'garage.audit_history',
];

const access = (over: Record<string, unknown> = {}) => ({
  features: {},
  garageId: 'g-1',
  name: 'Atelier Test',
  permissions: {
    canAnswerQuotes: true,
    canMoveBookings: true,
    canRecordFinalPrice: true,
  },
  role: 'owner',
  status: 'approved',
  ...over,
});

const me = (over: Record<string, unknown> = {}) =>
  ({
    capabilities: OWNER_CAPS,
    garageAccess: [access()],
    garageId: 'g-1',
    ...over,
  }) as unknown as MeDto;

const paths = (views: readonly { path: string }[]) => views.map((v) => v.path);

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

describe('the garage dashboard views under odd input', () => {
  afterEach(() => TestBed.resetTestingModule());

  // @traces 097-FR-001
  it('lists ten views in the specified order', () => {
    expect(paths(DASHBOARDS.garage.views)).toEqual([
      '',
      'requests',
      'schedule',
      'team',
      'prices',
      'reviews',
      'profile',
      'assistant',
      'settings',
      'history',
    ]);
  });

  // @traces 097-FR-002
  it('never offers the assistant, whatever the capabilities and features', () => {
    const everything = [...OWNER_CAPS, 'garage.assistant', 'garage.ai'];
    expect(paths(allowedViews('garage', everything, {}))).not.toContain(
      'assistant',
    );
    expect(
      paths(allowedViews('garage', everything, { assistant: true })),
    ).not.toContain('assistant');
  });

  // @traces 097-FR-002
  it('has no route for the assistant, so its address falls through', () => {
    const route = dashboardRoutes('garage').find((r) => r.path === 'assistant');
    expect(route).toBeUndefined();
    const last = dashboardRoutes('garage').at(-1);
    expect(last).toEqual({ path: '**', redirectTo: '' });
  });

  // @traces 097-FR-007
  it('hides the team only when its switch is exactly false', () => {
    const team = (features: Record<string, boolean>) =>
      paths(allowedViews('garage', OWNER_CAPS, features)).includes('team');
    expect(team({ team_mechanics: false })).toBe(false);
    expect(team({ team_mechanics: true })).toBe(true);
    expect(team({})).toBe(true);
    expect(team({ whatsapp: false })).toBe(true);
    expect(team({ Team_Mechanics: false })).toBe(true);
    expect(team({ ' team_mechanics': false })).toBe(true);
  });

  // @traces 097-FR-007
  it('treats a non-boolean switch value as not off', () => {
    const features = { team_mechanics: 0 } as unknown as Record<
      string,
      boolean
    >;
    expect(paths(allowedViews('garage', OWNER_CAPS, features))).toContain(
      'team',
    );
  });

  // @traces 097-FR-007
  it('survives prototype-polluting feature keys', () => {
    const features = JSON.parse(
      '{"__proto__": {"team_mechanics": false}, "constructor": false}',
    ) as Record<string, boolean>;
    expect(paths(allowedViews('garage', OWNER_CAPS, features))).toContain(
      'team',
    );
  });

  // @traces 097-FR-007
  it('refuses the team route when the switch is off and lets it through when on', async () => {
    const off = me({
      garageAccess: [access({ features: { team_mechanics: false } })],
    });
    expect(matches('team', off)).toBe(false);
    TestBed.resetTestingModule();
    expect(matches('team', me())).toBe(true);
  });

  // @traces 097-FR-007
  it('lets the team route through when the session garage matches no entry', () => {
    expect(matches('team', me({ garageId: 'other' }))).toBe(true);
  });

  // @traces 097-FR-001
  it('shows the history view to an owner and hides it without its capability', () => {
    expect(paths(allowedViews('garage', OWNER_CAPS))).toContain('history');
    expect(
      paths(
        allowedViews(
          'garage',
          OWNER_CAPS.filter((c) => c !== 'garage.audit_history'),
        ),
      ),
    ).not.toContain('history');
  });

  // @traces 097-FR-001
  it('keeps the settings view for an account with no capabilities at all', () => {
    expect(paths(allowedViews('garage', []))).toEqual(['', 'settings']);
  });

  // @traces 097-FR-006
  it('finds the garage by the session id among several entries', () => {
    const current = me({
      garageAccess: [
        access({ garageId: 'g-0', name: 'First' }),
        access({ garageId: 'g-1', name: 'Second' }),
        access({ garageId: 'g-2', name: 'Third' }),
      ],
    });
    expect(garageOf(current)?.name).toBe('Second');
  });

  // @traces 097-FR-006
  it('returns the first entry when two share the session id', () => {
    const current = me({
      garageAccess: [access({ name: 'First' }), access({ name: 'Duplicate' })],
    });
    expect(garageOf(current)?.name).toBe('First');
  });

  // @traces 097-FR-006
  it('finds no garage with no membership, an unmatched id or no session', () => {
    expect(garageOf(me({ garageAccess: [] }))).toBeNull();
    expect(garageOf(me({ garageId: 'nope' }))).toBeNull();
    expect(garageOf(me({ garageId: null }))).toBeNull();
    expect(garageOf(null)).toBeNull();
  });

  // @traces 097-FR-006
  it('does not match ids that differ only by case or whitespace', () => {
    expect(garageOf(me({ garageId: 'G-1' }))).toBeNull();
    expect(garageOf(me({ garageId: 'g-1 ' }))).toBeNull();
  });

  // @traces 097-FR-006
  it('does not match an undefined session id against an entry lacking one', () => {
    const current = me({
      garageAccess: [access({ garageId: undefined })],
      garageId: undefined,
    });
    expect(garageOf(current)).toBeNull();
  });

  // @traces 097-FR-008
  it('returns an unknown status untouched so only draft changes Panou', () => {
    const current = me({ garageAccess: [access({ status: 'archived' })] });
    expect(garageOf(current)?.status).toBe('archived');
  });

  // @traces 097-FR-007
  it('reads the switches of the matched garage, not of another entry', () => {
    const current = me({
      garageAccess: [
        access({ features: { team_mechanics: false }, garageId: 'g-0' }),
        access({ features: {}, garageId: 'g-1' }),
      ],
    });
    expect(garageOf(current)?.features).toEqual({});
    expect(matches('team', current)).toBe(true);
  });

  // @traces 097-FR-007
  it('refuses a route with no session and one the capabilities do not cover', () => {
    expect(matches('requests', null)).toBe(false);
    TestBed.resetTestingModule();
    expect(matches('team', me({ capabilities: [], garageAccess: [] }))).toBe(
      false,
    );
  });
});
