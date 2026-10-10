import type { ResponseRateDto } from '@motor-fix/contracts';

import { answersSameDayOf } from './response-stats';

const of = (rate: unknown) => answersSameDayOf(rate as ResponseRateDto);

// @traces 1025-FR-002
describe('answersSameDayOf at the edges', () => {
  it('holds at exactly 70 and not at 69.99', () => {
    expect(of({ rate: 70, state: 'rate' })).toBe(true);
    expect(of({ rate: 69.99, state: 'rate' })).toBe(false);
    expect(of({ rate: 70.01, state: 'rate' })).toBe(true);
  });

  it('holds for 100 and for a figure past 100', () => {
    expect(of({ rate: 100, state: 'rate' })).toBe(true);
    expect(of({ rate: 250, state: 'rate' })).toBe(true);
  });

  it('does not hold for a negative or NaN rate', () => {
    expect(of({ rate: -1, state: 'rate' })).toBe(false);
    expect(of({ rate: Number.NaN, state: 'rate' })).toBe(false);
  });
});

// @traces 1025-FR-003
describe('answersSameDayOf with contradictory or missing figures', () => {
  it('never holds in the new or none state, whatever rate rides along', () => {
    expect(of({ rate: 100, state: 'new' })).toBe(false);
    expect(of({ rate: 95, state: 'none' })).toBe(false);
  });

  it('is false, not undefined, when the rate state carries no rate', () => {
    expect(of({ state: 'rate' })).toBe(false);
    expect(of({ rate: null, state: 'rate' })).toBe(false);
  });

  it('is false for a rate sent as a string', () => {
    expect(of({ rate: '90', state: 'rate' })).toBe(false);
  });

  it('is false for an unknown state', () => {
    expect(of({ rate: 90, state: 'unknown' })).toBe(false);
  });

  it('always returns a strict boolean', () => {
    for (const input of [
      { state: 'new' },
      { state: 'none' },
      { rate: 80, state: 'rate' },
      { state: 'rate' },
    ]) {
      expect(typeof of(input)).toBe('boolean');
    }
  });

  it('gives the same answer twice for the same input', () => {
    const input = { rate: 70, state: 'rate' };
    expect(of(input)).toBe(of(input));
    expect(input).toEqual({ rate: 70, state: 'rate' });
  });
});
