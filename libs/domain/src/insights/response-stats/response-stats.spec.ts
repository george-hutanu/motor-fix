import { answersSameDayOf } from './response-stats';

// @traces 1025-FR-002
// @traces 1025-FR-003
describe('whether a garage usually answers the same day', () => {
  it('holds from 70 percent answered within a day up', () => {
    expect(answersSameDayOf({ rate: 70, state: 'rate' })).toBe(true);
    expect(answersSameDayOf({ rate: 70.01, state: 'rate' })).toBe(true);
    expect(answersSameDayOf({ rate: 100, state: 'rate' })).toBe(true);
  });

  it('does not hold below the threshold, for a new garage or one with nothing counted lately', () => {
    expect(answersSameDayOf({ rate: 69, state: 'rate' })).toBe(false);
    expect(answersSameDayOf({ rate: 69.99, state: 'rate' })).toBe(false);
    expect(answersSameDayOf({ state: 'rate' })).toBe(false);
    expect(answersSameDayOf({ rate: 0, state: 'rate' })).toBe(false);
    expect(answersSameDayOf({ state: 'new' })).toBe(false);
    expect(answersSameDayOf({ rate: 100, state: 'new' })).toBe(false);
    expect(answersSameDayOf({ state: 'none' })).toBe(false);
  });
});
