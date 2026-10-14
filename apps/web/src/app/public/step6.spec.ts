import { completedCount, readStep6 } from './step6';

describe('reading the verification step from a draft', () => {
  it('reads both values from the step-6 section', () => {
    expect(
      readStep6({ steps: { '6': { cui: '18547290', rarNumber: 'AB1' } } }),
    ).toEqual({ cui: '18547290', rarNumber: 'AB1' });
  });

  it.each([
    ['no data', {}],
    ['no section', { steps: { '1': { name: 'x' } } }],
    [
      'values that are not text',
      { steps: { '6': { cui: 1, rarNumber: null } } },
    ],
  ])('reads empty fields from %s', (_, data) => {
    expect(readStep6(data)).toEqual({ cui: '', rarNumber: '' });
  });
});

describe('the step counter', () => {
  it.each([
    [[false, false, false, false, false], 0],
    [[true, false, false, false, false], 1],
    [[true, true, false, false, false], 2],
    [[true, true, true, false, false], 3],
    [[true, true, true, true, false], 4],
    [[true, true, true, true, true], 5],
    [[false, true, false, true, false], 2],
  ])('counts %p as %i', (done, n) => {
    expect(
      completedCount(done as [boolean, boolean, boolean, boolean, boolean]),
    ).toBe(n);
  });
});

// @traces 206-FR-009
