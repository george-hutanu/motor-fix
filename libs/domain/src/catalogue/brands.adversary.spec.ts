import { BRANDS } from './brands';

describe('catalogue brands your form', () => {
  // @traces 007-FR-003
  it('gives every brand a non-empty Romanian your form', () => {
    const missing = BRANDS.filter((b) => !b.roPossessive?.trim()).map(
      (b) => b.key,
    );

    expect(missing).toEqual([]);
  });

  it('never uses an ASCII hyphen or another dash in a your form', () => {
    const bad = BRANDS.filter((b) => /[-‐‒-―−]/.test(b.roPossessive ?? '')).map(
      (b) => b.key,
    );

    expect(bad).toEqual([]);
  });

  it('ends every your form with a Romanian article', () => {
    const odd = BRANDS.filter(
      (b) => !/( ta|‑ul tău|ul tău)$/.test(b.roPossessive ?? ''),
    ).map((b) => `${b.key}: ${b.roPossessive}`);

    expect(odd).toEqual([]);
  });

  it('has no surrounding space or double space in a your form', () => {
    const bad = BRANDS.filter((b) =>
      /^\s|\s$|\s{2}/.test(b.roPossessive ?? ''),
    ).map((b) => b.key);

    expect(bad).toEqual([]);
  });
});
