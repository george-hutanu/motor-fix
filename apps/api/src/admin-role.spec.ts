// @traces 165-FR-001
import {
  CAPABILITIES,
  capabilitiesOf,
  ROLES,
} from '@motor-fix/contracts/capabilities';

const all = {
  canAnswerQuotes: true,
  canMoveBookings: true,
  canRecordFinalPrice: true,
};

describe('the one admin role', () => {
  it('holds every admin capability, and no other role holds any', () => {
    const admin = CAPABILITIES.filter((c) => c.startsWith('admin.'));
    const holders = admin.map((capability) => [
      capability,
      ROLES.filter((role) => capabilitiesOf(role, all).includes(capability)),
    ]);

    expect(admin.length).toBeGreaterThan(0);
    expect(holders).toEqual(admin.map((capability) => [capability, ['admin']]));
  });
});
