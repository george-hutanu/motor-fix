import { isFacilitiesNote, isHoursSection } from './garage-hours';

const CAR = '\u{1F697}';
const ACCENTED = 'é';

// @traces 330-FR-003
describe('the facilities note counted in code points', () => {
  it('accepts 200 astral characters, 400 UTF-16 units long', () => {
    const note = CAR.repeat(200);

    expect(isFacilitiesNote(note)).toBe(true);
    expect(isHoursSection({ facilitiesNote: note })).toBe(true);
  });

  it('accepts 200 code points of base letters and combining accents', () => {
    expect(isFacilitiesNote(ACCENTED.repeat(100))).toBe(true);
  });

  it('refuses 202 code points of base letters and combining accents', () => {
    expect(isFacilitiesNote(ACCENTED.repeat(101))).toBe(false);
  });

  it('refuses 201 letters even when wrapped in spaces', () => {
    expect(isHoursSection({ facilitiesNote: `   ${'a'.repeat(201)}   ` })).toBe(
      false,
    );
  });
});

// @traces 330-FR-003
describe('the facilities note refusing control characters and wrong types', () => {
  it.each([
    ['a carriage return', 'Doar la\rprogramare'],
    ['an escape', 'Doar la \u001b[31mprogramare'],
    ['a delete', 'Doar la\u007fprogramare'],
    ['a next-line control', 'Doar la\u0085programare'],
  ])('refuses %s', (_, facilitiesNote) => {
    expect(isFacilitiesNote(facilitiesNote)).toBe(false);
    expect(isHoursSection({ facilitiesNote })).toBe(false);
  });

  it.each([
    ['a boolean', true],
    ['an object', { ro: 'Doar la programare' }],
    ['a boxed string', new String('Doar la programare')],
  ])('refuses %s', (_, facilitiesNote) => {
    expect(isHoursSection({ facilitiesNote })).toBe(false);
  });
});
