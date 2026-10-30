import {
  CAPABILITIES,
  capabilitiesOf,
  type Permissions,
  ROLES,
} from './capabilities';

const none: Permissions = {
  canAnswerQuotes: false,
  canMoveBookings: false,
  canRecordFinalPrice: false,
};
const all: Permissions = {
  canAnswerQuotes: true,
  canMoveBookings: true,
  canRecordFinalPrice: true,
};

describe('the receptionist and the garage profile capability', () => {
  // @traces 1369-FR-002
  it('grants the receptionist garage.profile whatever permissions she carries', () => {
    expect(capabilitiesOf('receptionist', none)).toContain('garage.profile');
    expect(capabilitiesOf('receptionist', all)).toContain('garage.profile');
    expect(
      capabilitiesOf('receptionist', undefined as unknown as Permissions),
    ).toContain('garage.profile');
    expect(
      capabilitiesOf('receptionist', null as unknown as Permissions),
    ).toContain('garage.profile');
  });

  // @traces 1369-FR-002
  it('refuses the mechanic garage.profile even with hostile permission values', () => {
    const hostile = {
      canAnswerQuotes: 'true',
      canMoveBookings: 1,
      canRecordFinalPrice: {},
      'garage.profile': true,
    } as unknown as Permissions;

    expect(capabilitiesOf('mechanic', hostile)).not.toContain('garage.profile');
    expect(capabilitiesOf('mechanic', all)).not.toContain('garage.profile');
    expect(capabilitiesOf('mechanic', none)).not.toContain('garage.profile');
  });

  // @traces 1369-FR-002
  it('holds garage.profile for exactly the garage owner and the receptionist', () => {
    const holders = ROLES.filter((r) =>
      capabilitiesOf(r, all).includes('garage.profile'),
    );

    expect([...holders].sort()).toEqual(['garage', 'receptionist']);
  });

  // @traces 1369-FR-001
  it('gives the receptionist neither team nor prices, which the menu leaves out', () => {
    const held = capabilitiesOf('receptionist', all);

    expect(held).not.toContain('garage.team');
    expect(held).not.toContain('garage.prices');
  });

  // @traces 1369-FR-002
  it('lists garage.profile in the known capabilities and rejects look-alike roles', () => {
    expect(CAPABILITIES).toContain('garage.profile');
    for (const role of [
      'Receptionist',
      'RECEPTIONIST',
      'receptionist ',
      '__proto__',
      'constructor',
      'toString',
    ]) {
      expect(capabilitiesOf(role as never, all)).toEqual([]);
    }
  });

  // @traces 1369-FR-002
  it('does not let a caller mutate the receptionist row through a returned list', () => {
    const first = capabilitiesOf('receptionist', none);
    first.length = 0;

    expect(capabilitiesOf('receptionist', none)).toContain('garage.profile');
  });
});
