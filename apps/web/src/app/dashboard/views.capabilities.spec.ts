import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { CanMatchFn } from '@angular/router';
import {
  CAPABILITIES,
  capabilitiesOf,
} from '@motor-fix/contracts/capabilities';
import type { MeDto } from '@motor-fix/data-access';

import { Session } from './session';
import { allowedViews, DASHBOARDS, dashboardRoutes } from './views';

// @traces 102-FR-001
describe('the dashboard views and the capabilities table', () => {
  const every = Object.values(DASHBOARDS).flatMap(({ views, actions }) => [
    ...views,
    ...(actions ?? []),
  ]);

  it.each(
    every
      .filter((view) => view.capability)
      .map((view) => [view.label, view.capability as string]),
  )('names a capability of the table for %s (%s)', (_, capability) => {
    expect(CAPABILITIES as readonly string[]).toContain(capability);
  });

  it('checks at least one view of every area', () => {
    for (const area of ['driver', 'garage', 'admin'] as const)
      expect(DASHBOARDS[area].views.some((view) => view.capability)).toBe(true);
  });
});

// @traces 423-FR-005
// @traces 423-FR-010
describe("a mechanic's garage menu for each permission on and off", () => {
  const PERMISSIONS = [
    'canAnswerQuotes',
    'canMoveBookings',
    'canRecordFinalPrice',
  ] as const;
  // Every combination of the three permissions, eight in all.
  const combinations = Array.from({ length: 8 }, (_, bits) =>
    Object.fromEntries(
      PERMISSIONS.map((name, i) => [name, (bits & (1 << i)) !== 0]),
    ),
  ) as Record<(typeof PERMISSIONS)[number], boolean>[];
  const menu = (
    permissions: Record<(typeof PERMISSIONS)[number], boolean>,
    features: Record<string, boolean> = {},
  ) =>
    allowedViews(
      'garage',
      capabilitiesOf('mechanic', permissions),
      features,
    ).map((view) => view.path);

  it.each(combinations.map((p) => [JSON.stringify(p), p] as const))(
    'holds Panou, Lucrări, Istoric modificări, Setări and Programări, and Cereri de ofertă only with canAnswerQuotes, for %s',
    (_, permissions) => {
      expect(menu(permissions)).toEqual([
        '',
        ...(permissions.canAnswerQuotes ? ['requests'] : []),
        'schedule',
        'jobs',
        'settings',
        'history',
      ]);
    },
  );

  it.each(combinations.map((p) => [JSON.stringify(p), p] as const))(
    'drops Programări with the day sheets off, for %s',
    (_, permissions) => {
      expect(menu(permissions, { day_sheets: false })).not.toContain(
        'schedule',
      );
      expect(menu(permissions, { day_sheets: true })).toContain('schedule');
    },
  );

  it.each(combinations.map((p) => [JSON.stringify(p), p] as const))(
    'never gives her Echipa, Prețuri, Recenzii or Profilul service-ului, for %s',
    (_, permissions) => {
      for (const path of ['team', 'prices', 'reviews', 'profile'])
        expect(menu(permissions, { team_mechanics: true })).not.toContain(path);
    },
  );

  it('sends a typed address the menu lacks back to Panou', () => {
    const routes = dashboardRoutes('garage');
    expect(routes.at(-1)).toEqual({ path: '**', redirectTo: '' });
    for (const path of ['team', 'prices', 'reviews', 'profile'])
      expect(
        routes.find((route) => route.path === path)?.canMatch,
      ).toHaveLength(1);
  });

  it.each([
    [false, false],
    [true, true],
  ])(
    'lets her through to Cereri de ofertă only with canAnswerQuotes (%s)',
    (canAnswerQuotes, allowed) => {
      const capabilities = capabilitiesOf('mechanic', {
        canAnswerQuotes,
        canMoveBookings: true,
        canRecordFinalPrice: true,
      });
      const current = signal({
        capabilities,
        garageAccess: [
          {
            features: {},
            garageId: 'g-1',
            name: 'Atelier Test',
            permissions: {
              canAnswerQuotes,
              canMoveBookings: true,
              canRecordFinalPrice: true,
            },
            role: 'mechanic',
            status: 'approved',
          },
        ],
        garageId: 'g-1',
      } as unknown as MeDto);
      TestBed.configureTestingModule({
        providers: [{ provide: Session, useValue: { current } }],
      });
      const route = dashboardRoutes('garage').find(
        (r) => r.path === 'requests',
      );
      const guard = route?.canMatch?.[0] as CanMatchFn;

      expect(
        TestBed.runInInjectionContext(() =>
          guard(route as never, [], {} as never),
        ),
      ).toBe(allowed);
      TestBed.resetTestingModule();
    },
  );
});
