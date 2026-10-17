import { parseThresholds } from './thresholds';

// Fixture limits: not the build team's defaults.
const fixture = {
  api: { amber_ms: 10, red_ms: 20 },
  backup: { amber_h: 1, red_h: 2 },
  email: { amber_ms: 11, amber_share: 0.2, red_ms: 21, red_share: 0.4 },
  maps: { amber_ms: 12, red_ms: 22 },
  notifications: {
    amber_age_s: 13,
    amber_share: 0.3,
    red_age_s: 23,
    red_share: 0.6,
  },
  search: { amber_ms: 14, red_ms: 24 },
};

const withShare = (value: unknown) =>
  JSON.stringify({
    ...fixture,
    email: { ...fixture.email, red_share: value },
  });

// @traces 294-FR-001
// @traces 294-FR-005
describe('hostile STATUS_THRESHOLDS values', () => {
  it('accepts the full value with surrounding whitespace and newlines', () => {
    expect(
      parseThresholds(`\n  ${JSON.stringify(fixture, null, 2)}\n\t `),
    ).toEqual(fixture);
  });

  it.each([
    ['whitespace only', '   '],
    ['a bare number', '5'],
    ['a bare string', '"api"'],
    ['true', 'true'],
  ])('refuses %s', (_, raw) => {
    expect(() => parseThresholds(raw)).toThrow(/STATUS_THRESHOLDS/);
  });

  it('refuses a failed-send share above 1', () => {
    expect(() => parseThresholds(withShare(1.5))).toThrow(/STATUS_THRESHOLDS/);
  });

  it('accepts a failed-send share of exactly 1 and exactly 0', () => {
    expect(parseThresholds(withShare(1)).email.red_share).toBe(1);
    expect(parseThresholds(withShare(0)).email.red_share).toBe(0);
  });

  it('refuses a tile given as an array', () => {
    expect(() =>
      parseThresholds(JSON.stringify({ ...fixture, api: [10, 20] })),
    ).toThrow(/STATUS_THRESHOLDS/);
  });

  it('refuses a tile given as null', () => {
    expect(() =>
      parseThresholds(JSON.stringify({ ...fixture, backup: null })),
    ).toThrow(/STATUS_THRESHOLDS/);
  });

  it('refuses a boolean limit', () => {
    expect(() =>
      parseThresholds(
        JSON.stringify({ ...fixture, api: { amber_ms: true, red_ms: 20 } }),
      ),
    ).toThrow(/STATUS_THRESHOLDS/);
  });

  it('refuses a nested object as a limit', () => {
    expect(() =>
      parseThresholds(
        JSON.stringify({ ...fixture, api: { amber_ms: { v: 1 }, red_ms: 20 } }),
      ),
    ).toThrow(/STATUS_THRESHOLDS/);
  });

  it('refuses a __proto__ key smuggled in as an extra tile', () => {
    const raw = JSON.stringify(fixture).replace(
      '{"api"',
      '{"__proto__":{"amber_ms":1,"red_ms":2},"api"',
    );
    expect(() => parseThresholds(raw)).toThrow(/STATUS_THRESHOLDS/);
  });

  it('refuses a constructor key smuggled in as an extra field', () => {
    expect(() =>
      parseThresholds(
        JSON.stringify({ ...fixture, api: { ...fixture.api, constructor: 1 } }),
      ),
    ).toThrow(/STATUS_THRESHOLDS/);
  });

  it('does not pollute Object.prototype while refusing', () => {
    const raw = '{"__proto__":{"polluted":1}}';
    expect(() => parseThresholds(raw)).toThrow(/STATUS_THRESHOLDS/);
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
  });

  it('does not echo a limit value into the error message', () => {
    let message = '';
    try {
      parseThresholds(
        JSON.stringify({
          ...fixture,
          api: { amber_ms: 'sekret-7', red_ms: 1 },
        }),
      );
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toMatch(/STATUS_THRESHOLDS/);
    expect(message).not.toContain('sekret-7');
  });

  it('keeps the last of two duplicate keys, as JSON does, and still returns a full value', () => {
    const raw = JSON.stringify(fixture).replace(
      '"api":{"amber_ms":10,"red_ms":20}',
      '"api":{"amber_ms":1,"red_ms":2},"api":{"amber_ms":10,"red_ms":20}',
    );
    expect(parseThresholds(raw).api).toEqual({ amber_ms: 10, red_ms: 20 });
  });

  it('accepts a very large finite limit', () => {
    expect(
      parseThresholds(
        JSON.stringify({
          ...fixture,
          backup: { amber_h: 1e300, red_h: 2e300 },
        }),
      ).backup.red_h,
    ).toBe(2e300);
  });
});
