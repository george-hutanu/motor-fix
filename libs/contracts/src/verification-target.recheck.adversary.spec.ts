import { recheckedSince } from './verification-target';

describe('recheckedSince adversary', () => {
  // @traces 1354-FR-005
  it('is false with no re-check', () => {
    expect(recheckedSince(null, '2026-10-01')).toBe(false);
    expect(recheckedSince(undefined, '2026-10-01')).toBe(false);
  });

  // @traces 1354-FR-005
  it('is false with no stored date, even for an ok re-check', () => {
    expect(
      recheckedSince({ checkedOn: '2026-10-01', result: 'ok' }, null),
    ).toBe(false);
  });

  // @traces 1354-FR-005
  it('is true when the ok re-check is on the stored day', () => {
    expect(
      recheckedSince({ checkedOn: '2026-10-01', result: 'ok' }, '2026-10-01'),
    ).toBe(true);
  });

  // @traces 1354-FR-005
  it('is false when the ok re-check is one day before the stored day', () => {
    expect(
      recheckedSince({ checkedOn: '2026-09-30', result: 'ok' }, '2026-10-01'),
    ).toBe(false);
  });

  // @traces 1354-FR-005
  it('is true when the ok re-check is one day after the stored day', () => {
    expect(
      recheckedSince({ checkedOn: '2026-10-02', result: 'ok' }, '2026-10-01'),
    ).toBe(true);
  });

  // @traces 1354-FR-005
  it('is false for a failed re-check however recent', () => {
    expect(
      recheckedSince(
        { checkedOn: '2027-01-01', result: 'failed' },
        '2026-10-01',
      ),
    ).toBe(false);
  });

  // @traces 1354-FR-005
  it('compares across a year boundary as dates, not as numbers', () => {
    expect(
      recheckedSince({ checkedOn: '2027-01-02', result: 'ok' }, '2026-12-31'),
    ).toBe(true);
    expect(
      recheckedSince({ checkedOn: '2026-12-31', result: 'ok' }, '2027-01-02'),
    ).toBe(false);
  });

  // @traces 1354-FR-005
  it('is false for an empty stored date string', () => {
    expect(recheckedSince({ checkedOn: '2026-10-01', result: 'ok' }, '')).toBe(
      false,
    );
  });
});
