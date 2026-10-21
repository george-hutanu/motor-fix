import { submitTimeoutMs } from './submit.service';

describe('the send transaction timeout', () => {
  it('is 30 seconds when the variable is not set', () => {
    expect(submitTimeoutMs({})).toBe(30_000);
    expect(submitTimeoutMs({ LISTING_SUBMIT_TX_TIMEOUT_MS: '' })).toBe(30_000);
  });

  it('reads a positive whole number of milliseconds', () => {
    expect(submitTimeoutMs({ LISTING_SUBMIT_TX_TIMEOUT_MS: '45000' })).toBe(
      45_000,
    );
  });

  it.each(['0', '-5', '1.5', '30s', 'abc'])('refuses %s', (value) => {
    expect(() =>
      submitTimeoutMs({ LISTING_SUBMIT_TX_TIMEOUT_MS: value }),
    ).toThrow(/LISTING_SUBMIT_TX_TIMEOUT_MS/);
  });
});
