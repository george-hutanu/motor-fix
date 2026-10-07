import { groupPlate, isRomanianPlate, normalisePlate } from './plate';

describe('plate helpers under hostile input', () => {
  it('turns an empty text into an empty plate', () => {
    expect(normalisePlate('')).toBe('');
    expect(normalisePlate('   ')).toBe('');
    expect(normalisePlate('-- --')).toBe('');
  });

  it('removes every kind of space, not only the plain one', () => {
    expect(normalisePlate('B 123\tABC')).toBe('B123ABC');
  });

  it('does not change a plate already stored', () => {
    const once = normalisePlate('b 123-abc');
    expect(normalisePlate(once)).toBe(once);
  });

  it('keeps the tail of a very long text', () => {
    expect(normalisePlate(`${'a '.repeat(10_000)}`)).toBe('A'.repeat(10_000));
  });

  it('upper-cases a Romanian diacritic', () => {
    expect(normalisePlate('ș')).toBe('Ș');
  });

  it.each([
    '',
    'B',
    'B123ABC\n',
    ' B123ABC',
    'b123abc',
    'B123ABCD',
    'B1ABC',
    'B123AB',
    'B123ÅBC',
  ])('does not call %p a Romanian plate', (plate) => {
    expect(isRomanianPlate(plate)).toBe(false);
  });

  it('does not take Arabic-Indic digits for digits', () => {
    expect(isRomanianPlate('B١٢٣ABC')).toBe(false);
  });

  it.each(['', 'B', 'ABC', 'B123ABC1', 'b123abc', 'B 123 ABC'])(
    'leaves %p as stored when it cannot be grouped',
    (plate) => {
      expect(groupPlate(plate)).toBe(plate);
    },
  );

  it('groups the longest Romanian form', () => {
    expect(groupPlate('IF123XYZ')).toBe('IF 123 XYZ');
  });

  it('groups a short number', () => {
    expect(groupPlate('B12ABC')).toBe('B 12 ABC');
  });
});
