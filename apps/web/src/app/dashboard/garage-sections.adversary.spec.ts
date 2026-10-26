import {
  capabilitiesOf,
  type Permissions,
  type Role,
} from '@motor-fix/contracts/capabilities';
import type { MeDto } from '@motor-fix/data-access';

import { homeSections, linksTo } from './garage-sections';

const NONE: Permissions = {
  canAnswerQuotes: false,
  canMoveBookings: false,
  canRecordFinalPrice: false,
};

const me = (
  role: Role,
  features: Record<string, unknown> | undefined = {},
  status = 'approved',
  extra: Record<string, unknown> = {},
) =>
  ({
    capabilities: capabilitiesOf(role, NONE),
    garageAccess: [
      {
        features,
        garageId: 'garage-1',
        name: 'Atelier Test',
        permissions: NONE,
        role: role === 'garage' ? 'owner' : role,
        status,
      },
    ],
    garageId: 'garage-1',
    ...extra,
  }) as unknown as MeDto;

const keys = (account: MeDto | null) =>
  homeSections(account).map((section) => section.key);

// @traces 099-FR-002
describe('homeSections under hostile accounts', () => {
  it('returns nothing for a null account', () => {
    expect(homeSections(null)).toEqual([]);
  });

  it('returns nothing for an account without garage access', () => {
    expect(
      homeSections({
        capabilities: ['garage.profile'],
        garageAccess: [],
      } as unknown as MeDto),
    ).toEqual([]);
  });

  it('returns nothing for an account with no capabilities', () => {
    expect(
      homeSections({ ...me('garage'), capabilities: [] } as MeDto),
    ).toEqual([]);
  });

  it('returns nothing for a draft garage even for the owner', () => {
    expect(keys(me('garage', {}, 'draft'))).toEqual([]);
  });

  it('shows a suspended garage the sections of an approved one', () => {
    expect(keys(me('garage', {}, 'suspended'))).toEqual(keys(me('garage')));
  });

  it('counts a missing features object as everything on', () => {
    expect(keys(me('garage', undefined))).toContain('sched');
  });

  it('counts a null feature value as on', () => {
    expect(
      keys(me('garage', { lift_schedule: null, team_mechanics: null })),
    ).toEqual(['kpi', 'req', 'load', 'sched', 'funnel', 'brands', 'reviews']);
  });

  it('counts an unknown feature key as no switch', () => {
    expect(keys(me('garage', { nonsense: false }))).toHaveLength(7);
  });

  it('removes both switched sections when both are off', () => {
    expect(
      keys(me('garage', { lift_schedule: false, team_mechanics: false })),
    ).toEqual(['kpi', 'req', 'funnel', 'brands', 'reviews']);
  });

  it('leaves a mechanic with the lift switch off with only the load', () => {
    expect(keys(me('mechanic', { lift_schedule: false }))).toEqual(['load']);
  });

  it('leaves a mechanic with nothing when both switches are off', () => {
    expect(
      keys(me('mechanic', { lift_schedule: false, team_mechanics: false })),
    ).toEqual([]);
  });

  it('never returns the unreleased section even with every capability', () => {
    expect(keys(me('garage'))).not.toContain('now');
  });

  it('returns the same answer twice and a fresh array each time', () => {
    const account = me('garage');
    const first = homeSections(account);
    const second = homeSections(account);

    expect(second).toEqual(first);
    expect(second).not.toBe(first);
    first.pop();
    expect(homeSections(account)).toHaveLength(7);
  });

  it('does not mutate the declared list or the account', () => {
    const account = me('garage', { lift_schedule: false });
    const before = JSON.stringify(account);
    const keysBefore = homeSections(me('garage')).map((s) => s.key);
    homeSections(account);
    linksTo(account, 'schedule');

    expect(JSON.stringify(account)).toBe(before);
    expect(homeSections(me('garage')).map((s) => s.key)).toEqual(keysBefore);
  });
});

// @traces 099-FR-003
describe('linksTo under hostile input', () => {
  it('is false for a null account', () => {
    expect(linksTo(null, 'team')).toBe(false);
  });

  it.each(['nonsense', '/app/garage/team', 'TEAM', ' team', '../team'])(
    'is false for the view %j',
    (view) => {
      expect(linksTo(me('garage'), view)).toBe(false);
    },
  );

  it('is false for every view of a draft garage section target', () => {
    expect(linksTo(me('garage', {}, 'draft'), 'reviews')).toBe(false);
  });

  it('refuses the schedule when day_sheets is off even with lift_schedule on', () => {
    expect(
      linksTo(
        me('garage', { day_sheets: false, lift_schedule: true }),
        'schedule',
      ),
    ).toBe(false);
  });

  it('refuses the team when team_mechanics is off', () => {
    expect(linksTo(me('garage', { team_mechanics: false }), 'team')).toBe(
      false,
    );
  });

  it('never links a mechanic to the team, the profile or the reviews', () => {
    const mechanic = me('mechanic');

    expect(
      ['team', 'profile', 'reviews'].map((view) => linksTo(mechanic, view)),
    ).toEqual([false, false, false]);
  });

  it('links an owner to every target view with every feature on', () => {
    const owner = me('garage');

    expect(
      [...new Set(homeSections(owner).map((s) => s.view))].map((view) =>
        linksTo(owner, view),
      ),
    ).toEqual([true, true, true, true, true]);
  });

  it('links a mechanic with answer-quotes permission to requests', () => {
    const account = {
      ...me('mechanic'),
      capabilities: capabilitiesOf('mechanic', {
        ...NONE,
        canAnswerQuotes: true,
      }),
    } as MeDto;

    expect(linksTo(account, 'requests')).toBe(true);
  });
});
