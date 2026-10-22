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
  it('leaves an already non-breaking hyphen as it is', () => {
    expect(unbroken('Mercedes‑Benz')).toBe('Mercedes‑Benz');
  });

  // @traces 008-FR-004
  it('gives the same name when applied twice', () => {
    const once = unbroken('Rolls-Royce-Co');
    expect(unbroken(once)).toBe(once);
  });

  // @traces 008-FR-004
  it('leaves the en dash, the em dash and the minus sign alone', () => {
    expect(unbroken('A–B—C−D')).toBe('A–B—C−D');
  });

  // @traces 008-FR-004
  it('keeps the rest of a Romanian suffix form, only the hyphen changes', () => {
    expect(unbroken('BMW-ul tău')).toBe('BMW‑ul tău');
  });
});
