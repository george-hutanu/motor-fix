import { answersSameDayOf, RESPONSE_SAME_DAY_MIN_RATE } from './response-stats';

// @traces 1025-FR-002
// @traces 1025-FR-003
describe('whether a garage usually answers the same day', () => {
  it('starts at 70 percent answered within a day', () => {
    expect(RESPONSE_SAME_DAY_MIN_RATE).toBe(70);
  });

  it('holds from the threshold up', () => {
    expect(answersSameDayOf({ rate: 70, state: 'rate' })).toBe(true);
    expect(answersSameDayOf({ rate: 100, state: 'rate' })).toBe(true);
  });

  it('does not hold below the threshold, for a new garage or one with nothing counted lately', () => {
    expect(answersSameDayOf({ rate: 69, state: 'rate' })).toBe(false);
    expect(answersSameDayOf({ rate: 0, state: 'rate' })).toBe(false);
    expect(answersSameDayOf({ state: 'new' })).toBe(false);
    expect(answersSameDayOf({ state: 'none' })).toBe(false);
  });
});
