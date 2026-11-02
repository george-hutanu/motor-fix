import { capabilitiesOf } from '@motor-fix/contracts/capabilities';

import { allowedViews } from './views';

const NO_PERMISSIONS = {
  canAnswerQuotes: false,
  canMoveBookings: false,
  canRecordFinalPrice: false,
};
const ALL_PERMISSIONS = {
  canAnswerQuotes: true,
  canMoveBookings: true,
  canRecordFinalPrice: true,
};

const paths = (caps: readonly string[], features = {}, status?: never) =>
  allowedViews('garage', caps, features, status).map((v) => v.path);

describe('the garage menu of a receptionist built from the table row', () => {
  // @traces 1369-FR-001
  it('holds the profile view and neither the team nor the prices view', () => {
    const shown = paths(capabilitiesOf('receptionist', NO_PERMISSIONS));

    expect(shown).toContain('profile');
    expect(shown).not.toContain('team');
    expect(shown).not.toContain('prices');
  });

  // @traces 1369-FR-001
  it('is the same menu whichever mechanic permissions her payload carries', () => {
    expect(paths(capabilitiesOf('receptionist', ALL_PERMISSIONS))).toEqual(
      paths(capabilitiesOf('receptionist', NO_PERMISSIONS)),
    );
  });

  // @traces 1369-FR-001
  it('keeps the profile view when an unrelated feature switch is off', () => {
    expect(
      paths(capabilitiesOf('receptionist', NO_PERMISSIONS), { unknown: false }),
    ).toContain('profile');
  });

  // @traces 1369-FR-001
  it('opens nothing for a receptionist of a draft garage', () => {
    expect(
      paths(
        capabilitiesOf('receptionist', NO_PERMISSIONS),
        {},
        'draft' as never,
      ),
    ).toEqual([]);
  });

  // @traces 1369-FR-001
  it('has no profile view for the mechanic whatever his permissions', () => {
    expect(paths(capabilitiesOf('mechanic', ALL_PERMISSIONS))).not.toContain(
      'profile',
    );
    expect(paths(capabilitiesOf('mechanic', NO_PERMISSIONS))).not.toContain(
      'profile',
    );
  });

  // @traces 1369-FR-001
  it('has no profile view for an empty capability list', () => {
    expect(paths([])).not.toContain('profile');
  });

  // @traces 1369-FR-001
  it('does not match a capability by substring', () => {
    expect(
      paths(['garage.profile.extra', 'garage.profil', 'GARAGE.PROFILE']),
    ).not.toContain('profile');
  });
});
