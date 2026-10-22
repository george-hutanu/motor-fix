import { checkListing } from './listing-check';
import type { ListingDraftData } from '../listing-sections';

const CAR = '\u{1F697}';

// @traces 330-FR-002
describe('the listing check judging the facilities note', () => {
  const noteErrors = (facilitiesNote: unknown) =>
    checkListing({
      data: { steps: { '5': { facilitiesNote } } } as ListingDraftData,
    }).errors.filter((e) => e.field.startsWith('steps.5.facilitiesNote'));

  it.each([
    ['a line break', 'Doar la\nprogramare'],
    ['null', null],
    ['a number', 200],
    ['201 astral characters', CAR.repeat(201)],
  ])('reports a note holding %s as invalid', (_, note) => {
    expect(noteErrors(note)).toEqual([
      { code: 'invalid', field: 'steps.5.facilitiesNote' },
    ]);
  });

  it('reports nothing for 200 astral characters', () => {
    expect(noteErrors(CAR.repeat(200))).toEqual([]);
  });
});
