import { initials } from './initials';

describe('initials', () => {
  it.each([
    ['', ''],
    ['   ', ''],
    ['\t\n', ''],
    ['Ana', 'A'],
    ['Andrei M.', 'AM'],
    ['Ion Popescu Stan', 'IS'],
    ['Ana-Maria Pop', 'AP'],
    ['ștefan', 'Ș'],
    ['ștefan țuțea', 'ȘȚ'],
    ['  ana   pop  ', 'AP'],
    ['ana\tpop', 'AP'],
    ['ana\npop', 'AP'],
    ['ana pop', 'AP'],
    ['ana pop', 'AP'],
    ['élodie ñandú', 'ÉÑ'],
    ['a b c d e', 'AE'],
  ])('reads %j as %j', (name, expected) => {
    expect(initials(name)).toBe(expected);
  });

  it('keeps an emoji whole', () => {
    expect(initials('😀 Pop')).toBe('😀P');
    expect(initials('😀')).toBe('😀');
  });

  it('keeps a letter outside the basic plane whole', () => {
    expect(initials('𐐨𐐩 x')).toBe('𐐀X');
  });

  it('upper-cases i with the Romanian rules and not the Turkish dotted one', () => {
    expect(initials('ion ilie')).toBe('II');
  });

  it('gives one letter for a one-word name of many letters', () => {
    expect(initials('Constantinopolitanensis')).toBe('C');
  });

  it('copes with a very long name', () => {
    expect(initials(`${'a '.repeat(50_000)}z`)).toBe('AZ');
  });
});
