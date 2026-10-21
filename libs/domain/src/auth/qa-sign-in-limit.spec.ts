import { signInLimitConfig } from './qa-sign-in-limit';

// @traces 1361-FR-008

describe('signInLimitConfig', () => {
  it('lifts the sign-in route limit for 1 under APP_ENV=test', () => {
    const warn = jest.fn();
    expect(
      signInLimitConfig('test', { PR_QA_SIGN_IN_UNLIMITED: '1' }, warn),
    ).toBe(true);
    expect(warn).not.toHaveBeenCalled();
  });

  it.each([['0'], ['true'], ['false'], ['yes'], [''], [undefined]])(
    'keeps the limit for %s, with no warning',
    (value) => {
      const warn = jest.fn();
      expect(
        signInLimitConfig('test', { PR_QA_SIGN_IN_UNLIMITED: value }, warn),
      ).toBe(false);
      expect(warn).not.toHaveBeenCalled();
    },
  );

  it.each(['development', 'staging', 'production'])(
    'ignores the flag under %s and warns once',
    (appEnv) => {
      const warn = jest.fn();
      expect(
        signInLimitConfig(appEnv, { PR_QA_SIGN_IN_UNLIMITED: '1' }, warn),
      ).toBe(false);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0][0]).toMatch(/PR_QA_SIGN_IN_UNLIMITED/);
    },
  );

  it.each(['development', 'staging', 'production'])(
    'says nothing under %s when the flag is not set',
    (appEnv) => {
      const warn = jest.fn();
      expect(signInLimitConfig(appEnv, {}, warn)).toBe(false);
      expect(warn).not.toHaveBeenCalled();
    },
  );
});
