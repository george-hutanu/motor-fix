import { fold } from './fold';

describe('fold', () => {
  it.each([
    ['Vopsire ușă', 'vopsire usa'],
    ['ÎNLOCUIRE ȘTERGĂTOARE', 'inlocuire stergatoare'],
    ['Diagnoză', 'diagnoza'],
  ])('reads %j as %j, accents and case aside', (text, folded) => {
    expect(fold(text)).toBe(folded);
  });
});
