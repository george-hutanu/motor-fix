import { unbroken } from './voice';

describe('unbroken', () => {
  // @traces 008-FR-004
  it('returns an empty name as it is', () => {
    expect(unbroken('')).toBe('');
  });

  // @traces 008-FR-004
  it('turns every hyphen of a repeated, leading or trailing run', () => {
    expect(unbroken('-A--B-')).toBe('‑A‑‑B‑');
  });

  // @traces 008-FR-004
  it('leaves the en dash, the em dash and the minus sign alone', () => {
    expect(unbroken('A–B—C−D')).toBe('A–B—C−D');
  });
});
