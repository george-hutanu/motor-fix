import { capabilitiesOf } from './capabilities';

const all = {
  canAnswerQuotes: true,
  canMoveBookings: true,
  canRecordFinalPrice: true,
};

// @traces 409-FR-002
describe('garage.client_repairs under odd callers', () => {
  it('is not granted to a mechanic holding every permission flag', () => {
    expect(capabilitiesOf('mechanic', all)).not.toContain(
      'garage.client_repairs',
    );
  });

  it('is not granted to a receptionist with every flag on', () => {
    expect(capabilitiesOf('receptionist', all)).not.toContain(
      'garage.client_repairs',
    );
  });

  it('is not granted to an unknown role', () => {
    expect(capabilitiesOf('system' as never, all)).toEqual([]);
  });

  it('is not granted to a prototype-named role', () => {
    expect(capabilitiesOf('constructor' as never, all)).toEqual([]);
    expect(capabilitiesOf('__proto__' as never, all)).toEqual([]);
  });

  it('is granted to the owner with no permission object at all', () => {
    expect(capabilitiesOf('garage', undefined as never)).toContain(
      'garage.client_repairs',
    );
  });

  it('cannot be added to the table by editing a returned list', () => {
    capabilitiesOf('receptionist', all).push('garage.client_repairs');
    expect(capabilitiesOf('receptionist', all)).not.toContain(
      'garage.client_repairs',
    );
  });
});
