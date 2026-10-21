import { PAID_BANI_MAX, parseLeiText } from './lei-text';

// @traces 022-review-drawer-FR-005 022-review-drawer-FR-017
describe('parseLeiText', () => {
  it.each([
    ['890', 89_000],
    ['4.200', 420_000],
    ['4.200,50', 420_050],
    ['4.200,5', 420_050],
    ['4200', 420_000],
    ['4 200 lei', 420_000],
    [' 890 LEI ', 89_000],
    ['1.000.000', 100_000_000],
    ['0,01', 1],
  ])('reads %p as %p bani', (text, bani) => {
    expect(parseLeiText(text)).toEqual({ bani });
  });

  it.each([
    ['0', 'min'],
    ['0,00', 'min'],
    ['-5', 'min'],
    ['1.000.000,01', 'max'],
    ['2.000.000', 'max'],
    ['4.200,505', 'decimals'],
    ['12a', 'format'],
    ['4,200.50', 'format'],
    ['42.00', 'format'],
    ['€40', 'format'],
    ['', 'format'],
    ['lei', 'format'],
  ])('refuses %p as %p', (text, error) => {
    expect(parseLeiText(text)).toEqual({ error });
  });

  it('caps the amount at one million lei', () => {
    expect(PAID_BANI_MAX).toBe(100_000_000);
  });
});
