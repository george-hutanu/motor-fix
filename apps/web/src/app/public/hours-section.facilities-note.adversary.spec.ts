import { hoursOf, mergeHours } from './hours-section';

const data = (section: unknown) => ({ steps: { '5': section } });
const CAR = '\u{1F697}';

// @traces 330-FR-001
describe('the facilities note read from and put back into the draft', () => {
  it('reads back a note of 200 astral characters unchanged', () => {
    expect(hoursOf(data({ facilitiesNote: CAR.repeat(200) }))).toEqual({
      facilitiesNote: CAR.repeat(200),
    });
  });

  it.each([
    ['a line break', 'Doar la\nprogramare'],
    ['null', null],
    ['a number', 7],
  ])('reads a note holding %s as absent', (_, facilitiesNote) => {
    expect(
      hoursOf(data({ facilities: ['waiting_area'], facilitiesNote })),
    ).not.toHaveProperty('facilitiesNote');
  });

  it('keeps the place of the section when the note is put back', () => {
    const place = { address: 'Str. Lungă 1, Brașov', lat: 45.65, lng: 25.6 };

    expect(
      mergeHours({ place }, { facilitiesNote: 'Doar la programare' }),
    ).toMatchObject({ facilitiesNote: 'Doar la programare', place });
  });
});
