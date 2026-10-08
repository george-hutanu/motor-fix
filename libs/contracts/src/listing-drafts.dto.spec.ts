import { isListingDraftData } from './listing-sections';

const JOB = '0b9f3c1e-6a43-4c55-9d1c-6f3f1b7d2a10';

describe('the draft envelope', () => {
  it('accepts good details, prices and mechanics sections', () => {
    expect(
      isListingDraftData({
        steps: {
          '1': { businessKind: 'pfa', name: 'Service Ion' },
          '3': { jobs: [{ fromBani: 10_000, jobTypeId: JOB }], labour: {} },
          '4': { mechanics: [{ name: 'Ion' }], onProfile: true },
        },
      }),
    ).toBe(true);
  });

  it.each([
    ['details', { '1': { businessKind: 'srl' } }],
    ['prices', { '3': { jobs: [{ fromBani: 100 }] } }],
    ['mechanics', { '4': { onProfile: 'no' } }],
  ])('refuses malformed %s', (_, steps) => {
    expect(isListingDraftData({ steps })).toBe(false);
  });

  it('still holds step 2 as any record', () => {
    expect(isListingDraftData({ steps: { '2': { anything: 1 } } })).toBe(true);
  });

  it('keeps a place beside the opening hours in step 5', () => {
    expect(
      isListingDraftData({
        steps: {
          '5': {
            facilities: [],
            place: { address: 'Strada Exemplu 1', lat: 44.43, lng: 26.1 },
          },
        },
      }),
    ).toBe(true);
  });

  it('keeps step 5 with no place', () => {
    expect(isListingDraftData({ steps: { '5': { facilities: [] } } })).toBe(
      true,
    );
  });

  it.each([
    ['a latitude alone', { lat: 44.43 }],
    ['a radius past the limit', { radiusKm: 101 }],
    ['an unknown key', { seat: 'Strada Exemplu 1' }],
    ['text in place of a record', 'Strada Exemplu 1'],
  ])('refuses a step 5 place with %s', (_, place) => {
    expect(isListingDraftData({ steps: { '5': { place } } })).toBe(false);
  });
});
