import { initials } from './initials';

describe('initials', () => {
  it.each([
    ['Andrei M.', 'AM'],
    ['Ioana Pop', 'IP'],
    ['Ana-Maria Pop', 'AP'],
    ['Ion Popescu Stan', 'IS'],
    ['  ion   popescu  ', 'IP'],
    ['Ana', 'A'],
    ['ștefan', 'Ș'],
    ['ion țepeș', 'IȚ'],
  ])('reads %p as %p', (name, letters) => {
    expect(initials(name)).toBe(letters);
  });

  it('keeps a first character outside the basic plane whole', () => {
    expect(initials('😀 Pop')).toBe('😀P');
    expect([...initials('😀 Pop')]).toHaveLength(2);
  });

  it.each(['', '   ', '\t\n'])('gives none for the empty name %p', (name) => {
    expect(initials(name)).toBe('');
  });
});
