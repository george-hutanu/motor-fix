import {
  AUTH_LIMITS,
  COUNTED_IN_DATABASE,
  ROUTE_LIMITS,
  THROTTLES,
} from './rate-limit.config';

const rules = [...Object.values(ROUTE_LIMITS), ...Object.values(THROTTLES)];

// @traces 1181-FR-002
describe('the one place every limit is set', () => {
  it('gives every rule a count and a window of at least one', () => {
    for (const rule of rules) {
      expect(rule.limit).toBeGreaterThanOrEqual(1);
      expect(rule.windowSeconds).toBeGreaterThanOrEqual(1);
    }
    for (const group of Object.values(AUTH_LIMITS)) {
      for (const value of Object.values(group)) {
        expect(value).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it('keeps every rule under a key prefix of its own', () => {
    const keys = rules.map((rule) => rule.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('keeps the route limits under one prefix a test run can clear', () => {
    for (const rule of Object.values(ROUTE_LIMITS)) {
      expect(rule.key).toMatch(/^limit:/);
    }
  });

  it('sets the route limits the table names', () => {
    const set = Object.fromEntries(
      Object.entries(ROUTE_LIMITS).map(([name, r]) => [
        name,
        [r.limit, r.windowSeconds, r.per],
      ]),
    );
    expect(set).toEqual({
      assistant: [60, 60, 'key'],
      pushTest: [5, 600, 'key'],
      quoteSend: [60, 3600, 'key'],
      search: [120, 60, 'address'],
      signInAttempts: [30, 900, 'address'],
      uploadUrl: [60, 3600, 'key'],
    });
  });

  it('keeps the limits that were already set at their numbers', () => {
    expect(THROTTLES.assistantSignIn).toMatchObject({
      limit: 120,
      windowSeconds: 60,
    });
    expect(THROTTLES.consents).toMatchObject({
      limit: 20,
      windowSeconds: 3600,
    });
    expect(THROTTLES.listingDraftCreate).toMatchObject({
      limit: 10,
      windowSeconds: 3600,
    });
    expect(THROTTLES.places).toMatchObject({ limit: 60, windowSeconds: 60 });
    expect(THROTTLES.profileViews).toMatchObject({
      limit: 60,
      windowSeconds: 60,
    });
    expect(THROTTLES.supportAddress).toMatchObject({
      limit: 5,
      windowSeconds: 3600,
    });
    expect(THROTTLES.supportAccount).toMatchObject({
      limit: 5,
      windowSeconds: 3600,
    });
    expect(AUTH_LIMITS).toEqual({
      contactChange: { limit: 5, windowSeconds: 3600 },
      password: { limit: 5, windowSeconds: 900 },
      phoneCode: { address: 20, hour: 5, minute: 1, windowSeconds: 3600 },
      reset: { address: 10, email: 3, windowSeconds: 3600 },
      signInFailures: { address: 20, email: 5, windowSeconds: 900 },
      signUp: { limit: 10, windowSeconds: 3600 },
    });
    expect(COUNTED_IN_DATABASE).toEqual({
      draftLinksPerHour: 5,
      quoteRequestsPerDay: 20,
    });
  });
});
