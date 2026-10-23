import { fold } from './fold';

describe('fold', () => {
  it.each([
    ['Vopsire ușă', 'vopsire usa'],
    ['ÎNLOCUIRE ȘTERGĂTOARE', 'inlocuire stergatoare'],
    ['Diagnoză', 'diagnoza'],
    ['Schimb ulei\u200B', 'schimb ulei'],
    ['Schimb\u00AD\u2060ulei\uFEFF', 'schimbulei'],
  ])(
    'reads %j as %j, accents, case and format characters aside',
    (text, folded) => {
      expect(fold(text)).toBe(folded);
    },
  );
});
