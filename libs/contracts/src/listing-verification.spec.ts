import {
  isStep6Section,
  isValidCui,
  normaliseRarNumber,
  RAR_NUMBER_MIN,
  stripCui,
} from './listing-verification';

describe('a company tax ID as the owner types it', () => {
  it.each([
    ['with the RO prefix', 'RO18547290'],
    ['without a prefix', '18547290'],
    ['with a lower-case prefix and spaces', 'ro 18 547 290'],
    ['with a space after the prefix', 'RO 18547290'],
  ])('keeps the digits only, %s', (_, typed) => {
    expect(stripCui(typed)).toBe('18547290');
  });

  it('reads a prefix alone as an empty field', () => {
    expect(stripCui('RO')).toBe('');
    expect(stripCui(' ro ')).toBe('');
  });

  it('keeps any other character it does not understand', () => {
    expect(stripCui('RO 1854729A')).toBe('1854729A');
    expect(stripCui('18-547')).toBe('18-547');
  });
});

describe('the control digit of a company tax ID', () => {
  it.each(['18547290', '14399840', '19', '1234567897'])('accepts %s', (cui) => {
    expect(isValidCui(cui)).toBe(true);
  });

  it.each([
    ['a wrong control digit', '18547291'],
    ['a single digit', '1'],
    ['eleven digits', '12345678901'],
    ['a letter among the digits', '1854729A'],
    ['nothing', ''],
    ['the prefix still on it', 'RO18547290'],
  ])('refuses %s', (_, cui) => {
    expect(isValidCui(cui)).toBe(false);
  });

  it('answers the examples the owner sees, after stripping', () => {
    expect(isValidCui(stripCui('RO18547290'))).toBe(true);
    expect(isValidCui(stripCui('18547290'))).toBe(true);
    expect(isValidCui(stripCui('RO 18547291'))).toBe(false);
  });
});

describe('a RAR authorisation number as the owner types it', () => {
  it('trims it and puts it in capitals, keeping what is inside', () => {
    expect(normaliseRarNumber('  ab-12 / 3c ')).toBe('AB-12 / 3C');
  });

  it('trims before it cuts', () => {
    expect(normaliseRarNumber(`   ${'a'.repeat(40)}`)).toBe('A'.repeat(40));
  });

  it('keeps 40 characters and cuts the 41st', () => {
    expect(normaliseRarNumber('b'.repeat(40))).toHaveLength(40);
    expect(normaliseRarNumber('b'.repeat(41))).toBe('B'.repeat(40));
  });

  it('counts as done from 3 characters', () => {
    expect(normaliseRarNumber(' ab ').length).toBeLessThan(RAR_NUMBER_MIN);
    expect(normaliseRarNumber(' abc ').length).toBe(RAR_NUMBER_MIN);
  });
});

describe('the step-6 section of a listing draft', () => {
  it.each([
    ['empty', {}],
    ['with both values', { cui: '18547290', rarNumber: 'AB123' }],
    ['with a CUI that fails its control digit', { cui: '18547291' }],
    ['with a short RAR number', { rarNumber: 'A' }],
    ['with 40 characters', { rarNumber: 'X'.repeat(40) }],
  ])('is accepted %s', (_, section) => {
    expect(isStep6Section(section)).toBe(true);
  });

  it.each([
    ['an unknown key', { cui: '18547290', name: 'SRL' }],
    ['a number', { cui: 18547290 }],
    ['null', { rarNumber: null }],
    ['41 characters', { cui: '1'.repeat(41) }],
    ['a list', ['18547290']],
    ['nothing at all', null],
    ['a string', '18547290'],
  ])('is refused with %s', (_, section) => {
    expect(isStep6Section(section)).toBe(false);
  });
});
