import { retryDelay } from './notifications.processor';

const MINUTE = 60_000;

describe('the retry schedule', () => {
  it.each([
    [0, 1],
    [1, 5],
    [2, 15],
    [3, 60],
    [4, 240],
  ])('waits after attempt %i for %i minutes', (attempts, minutes) => {
    expect(retryDelay(attempts)).toBe(minutes * MINUTE);
  });

  it('only ever grows', () => {
    const delays = [0, 1, 2, 3, 4].map(retryDelay);
    expect([...delays].sort((a, b) => a - b)).toEqual(delays);
  });

  it('returns whole milliseconds', () => {
    for (const n of [0, 1, 2, 3, 4])
      expect(Number.isInteger(retryDelay(n))).toBe(true);
  });
});
