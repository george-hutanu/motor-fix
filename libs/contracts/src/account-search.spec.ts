import { isAccountState, readRoles, settleSearch } from './account-search';

// @traces 002-FR-002
// @traces 002-FR-003
describe('settleSearch', () => {
  it('trims the text and collapses its inner whitespace to one space', () => {
    expect(settleSearch('  andrei \t  marin\n')).toBe('andrei marin');
  });

  it('composes a base letter and a combining mark into the one letter', () => {
    expect(settleSearch('Ștefan')).toBe('Ștefan');
    expect(settleSearch('ă')).toBe('ă');
  });

  it('leaves an empty or blank text empty', () => {
    expect(settleSearch('')).toBe('');
    expect(settleSearch('   ')).toBe('');
  });
});

// @traces 002-FR-005
// @traces 002-FR-010
describe('readRoles', () => {
  it('reads comma-separated and repeated values as each role once, in the fixed order', () => {
    expect(readRoles(['mechanic,driver', 'mechanic', 'admin'])).toEqual({
      roles: ['driver', 'mechanic', 'admin'],
      unknown: [],
    });
  });

  it('reads an empty value as no role', () => {
    expect(readRoles([''])).toEqual({ roles: [], unknown: [] });
    expect(readRoles([',,'])).toEqual({ roles: [], unknown: [] });
  });

  it('sets an unknown value apart, keeping the known ones', () => {
    expect(readRoles(['pilot,garage', 'Driver'])).toEqual({
      roles: ['garage'],
      unknown: ['pilot', 'Driver'],
    });
  });
});

describe('isAccountState', () => {
  it.each(['active', 'watch', 'suspended'])('knows %s', (value) => {
    expect(isAccountState(value)).toBe(true);
  });

  it.each(['deleted', 'Active', ''])('does not know %p', (value) => {
    expect(isAccountState(value)).toBe(false);
  });
});
