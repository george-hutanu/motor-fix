import { groupPlate, isRomanianPlate, normalisePlate } from './plate';

describe('a registration plate as the person types it', () => {
  it.each([
    ['b 123 abc', 'B123ABC'],
    ['b 123-abc', 'B123ABC'],
    ['  cj-12-xyz ', 'CJ12XYZ'],
    ['M-AB 1234', 'MAB1234'],
  ])('stores %p as %p', (typed, stored) => {
    expect(normalisePlate(typed)).toBe(stored);
  });
});

describe('the Romanian plate pattern', () => {
  it.each(['B123ABC', 'B12ABC', 'CJ12ABC', 'IF123XYZ'])('takes %p', (plate) => {
    expect(isRomanianPlate(plate)).toBe(true);
  });

  it.each(['XYZ', 'B1234ABC', 'ABC12ABC', 'B12AB', '123ABC', 'MAB1234'])(
    'warns about %p',
    (plate) => {
      expect(isRomanianPlate(plate)).toBe(false);
    },
  );
});

describe('the plate on the owner card', () => {
  it.each([
    ['B123ABC', 'B 123 ABC'],
    ['CJ12ABC', 'CJ 12 ABC'],
  ])('groups %p as %p', (stored, shown) => {
    expect(groupPlate(stored)).toBe(shown);
  });

  it('shows a plate outside the pattern as stored', () => {
    expect(groupPlate('MAB1234')).toBe('MAB1234');
  });
});
