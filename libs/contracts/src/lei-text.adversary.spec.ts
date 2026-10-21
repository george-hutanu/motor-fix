import { PAID_BANI_MAX, parseLeiText } from './lei-text';

// @traces 022-FR-005 022-FR-017
describe('parseLeiText on hostile amounts', () => {
  it.each([
    ['007', 700],
    ['0,50', 50],
    ['4,2', 420],
    ['4,20', 420],
    ['1.000.000,00', 100_000_000],
    ['0,01', 1],
    ['4 200 LEI', 420_000],
    ['4 200 Lei', 420_000],
    ['4200lei', 420_000],
    ['  4.200,50  lei  ', 420_050],
    ['4 200 lei', 420_000],
    ['4 200 lei', 420_000],
    ['\t4200\n', 420_000],
  ])('reads %p as %p bani', (text, bani) => {
    expect(parseLeiText(text)).toEqual({ bani });
  });

  it.each([
    ['1.000.000,01', 'max'],
    ['1.000.001', 'max'],
    ['99999999999999999999', 'max'],
    ['99.999.999.999.999.999.999,99', 'max'],
  ])('refuses %p as too large', (text, error) => {
    expect(parseLeiText(text)).toEqual({ error });
  });

  it.each([
    ['0', 'min'],
    ['00', 'min'],
    ['0,00', 'min'],
    ['-0', 'min'],
    ['-0,00', 'min'],
    ['-1', 'min'],
    ['-4.200,50', 'min'],
  ])('refuses %p as not positive', (text, error) => {
    expect(parseLeiText(text)).toEqual({ error });
  });

  it.each([['4,200'], ['4,000'], ['0,001'], ['1.000.000,000']])(
    'refuses %p for its third decimal',
    (text) => {
      expect(parseLeiText(text)).toEqual({ error: 'decimals' });
    },
  );

  it.each([
    ['4.20'],
    ['4.2'],
    ['1.00'],
    ['4..200'],
    ['4.200.5'],
    ['.200'],
    ['4.'],
    ['4,'],
    [',50'],
    ['4,2,3'],
    ['4,200.50'],
    ['4.200,50,1'],
    ['1,000,000'],
    ['+5'],
    ['1e3'],
    ['0x10'],
    ['Infinity'],
    ['NaN'],
    ['4200 lei lei'],
    ['lei 4200'],
    ['4 lei 200'],
    ['RON 40'],
    ['40 €'],
    ['٤٢٠٠'],
    ['４２００'],
    ['4​200'],
    ['4200\u0000'],
    ['--5'],
    ['4_200'],
    ["4'200"],
  ])('refuses %p as a format problem', (text) => {
    expect(parseLeiText(text)).toEqual({ error: 'format' });
  });

  it('refuses an empty or blank text', () => {
    expect(parseLeiText('')).toEqual({ error: 'format' });
    expect(parseLeiText('   ')).toEqual({ error: 'format' });
    expect(parseLeiText(' ')).toEqual({ error: 'format' });
  });

  it('gives the same answer twice and never an unsafe integer', () => {
    const first = parseLeiText('1.000.000');
    expect(parseLeiText('1.000.000')).toEqual(first);
    expect(first).toEqual({ bani: PAID_BANI_MAX });
  });

  it('copes with a very long text without hanging', () => {
    const started = Date.now();
    expect(parseLeiText('1'.repeat(200_000))).toEqual({ error: 'max' });
    expect(parseLeiText(`${' '.repeat(200_000)}x`)).toEqual({
      error: 'format',
    });
    expect(Date.now() - started).toBeLessThan(2000);
  });
});
