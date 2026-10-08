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
});
