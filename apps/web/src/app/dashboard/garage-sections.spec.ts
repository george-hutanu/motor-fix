import {
  capabilitiesOf,
  type Permissions,
  type Role,
} from '@motor-fix/contracts/capabilities';
import type { MeDto } from '@motor-fix/data-access';

import { GARAGE_SECTIONS, homeSections, linksTo } from './garage-sections';

const NONE: Permissions = {
  canAnswerQuotes: false,
  canMoveBookings: false,
  canRecordFinalPrice: false,
};

const me = (
  role: Role,
  {
    features = {},
    permissions = NONE,
    status = 'approved',
  }: {
    features?: Record<string, boolean>;
    permissions?: Permissions;
    status?: 'draft' | 'approved' | 'suspended';
  } = {},
) =>
  ({
    capabilities: capabilitiesOf(role, permissions),
    garageAccess: [
      {
        features,
        garageId: 'garage-1',
        name: 'Atelier Test',
        permissions,
        role: role === 'garage' ? 'owner' : role,
        status,
      },
    ],
    garageId: 'garage-1',
  }) as unknown as MeDto;

const keys = (account: MeDto | null) =>
  homeSections(account).map((section) => section.key);

// @traces 099-FR-001
describe('the sections of Panou', () => {
  it('declares the eight keys in their default order', () => {
    expect(GARAGE_SECTIONS.map((section) => section.key)).toEqual([
      'kpi',
      'now',
      'req',
      'load',
      'sched',
      'funnel',
      'brands',
      'reviews',
    ]);
  });

  it('opens each section on its full view', () => {
    expect(
      Object.fromEntries(GARAGE_SECTIONS.map((s) => [s.key, s.view])),
    ).toEqual({
      brands: 'profile',
      funnel: 'profile',
      kpi: 'profile',
      load: 'team',
      now: 'schedule',
      req: 'requests',
      reviews: 'reviews',
      sched: 'schedule',
    });
  });

  it('gives every section not built yet a sentence of its own', () => {
    const empty = GARAGE_SECTIONS.filter((section) => section.empty);

    expect(empty.map((section) => section.key)).toEqual([
      'kpi',
      'now',
      'load',
      'sched',
      'funnel',
      'brands',
    ]);
    expect(new Set(empty.map((section) => section.empty)).size).toBe(6);
  });
});

// @traces 099-FR-002
describe('which sections each person sees', () => {
  it.each([
    ['the owner', me('garage')],
    ['the receptionist', me('receptionist')],
  ])('shows %s every released section', (_, account) => {
    expect(keys(account)).toEqual([
      'kpi',
      'req',
      'load',
      'sched',
      'funnel',
      'brands',
      'reviews',
    ]);
  });

  it('shows a mechanic without permissions only the load and the lifts', () => {
    expect(keys(me('mechanic'))).toEqual(['load', 'sched']);
  });

  it('adds the requests for a mechanic who may answer quotes', () => {
    expect(
      keys(me('mechanic', { permissions: { ...NONE, canAnswerQuotes: true } })),
    ).toEqual(['req', 'load', 'sched']);
  });

  it.each([
    ['lift_schedule', 'sched'],
    ['team_mechanics', 'load'],
  ])('leaves a section out for everyone while %s is off', (feature, key) => {
    for (const role of ['garage', 'receptionist', 'mechanic'] as const)
      expect(keys(me(role, { features: { [feature]: false } }))).not.toContain(
        key,
      );
  });

  it('counts a feature missing from the switches as on', () => {
    expect(keys(me('garage', { features: { lift_schedule: true } }))).toContain(
      'sched',
    );
  });

  it('keeps "În lucru acum" out while it is not released', () => {
    expect(GARAGE_SECTIONS.find((s) => s.key === 'now')?.unreleased).toBe(true);
    expect(keys(me('garage'))).not.toContain('now');
  });

  it('shows the sections of a suspended garage as of an approved one', () => {
    expect(keys(me('garage', { status: 'suspended' }))).toEqual(
      keys(me('garage')),
    );
  });

  it('shows no section to a draft garage or without a garage', () => {
    expect(keys(me('garage', { status: 'draft' }))).toEqual([]);
    expect(keys(null)).toEqual([]);
  });
});

// @traces 099-FR-003
describe('whether a section title opens its view', () => {
  it('links the owner to every view while every feature is on', () => {
    for (const view of ['requests', 'team', 'schedule', 'profile', 'reviews'])
      expect(linksTo(me('garage'), view)).toBe(true);
  });

  it('keeps the title plain where the menu lacks the view', () => {
    expect(linksTo(me('mechanic'), 'team')).toBe(false);
    expect(linksTo(me('receptionist'), 'team')).toBe(false);
    expect(
      linksTo(me('garage', { features: { day_sheets: false } }), 'schedule'),
    ).toBe(false);
    expect(linksTo(me('garage', { status: 'draft' }), 'profile')).toBe(false);
    expect(linksTo(null, 'profile')).toBe(false);
  });
});
