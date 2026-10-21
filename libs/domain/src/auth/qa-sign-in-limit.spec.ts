import { signInLimitConfig } from './qa-sign-in-limit';

// @traces 1361-watch-schedule-qa-telemetry-FR-008

describe('signInLimitConfig', () => {
  it.each(['1', 'true'])(
    'lifts the sign-in route limit for %s under APP_ENV=test',
    (value) => {
      const warn = jest.fn();
      expect(
        signInLimitConfig('test', { PR_QA_SIGN_IN_UNLIMITED: value }, warn),
      ).toEqual({ skipAttemptsLimit: true });
      expect(warn).not.toHaveBeenCalled();
    },
  );

  it.each([['0'], ['false'], ['yes'], [''], [undefined]])(
    'keeps the limit for %s, with no warning',
    (value) => {
      const warn = jest.fn();
      expect(
        signInLimitConfig('test', { PR_QA_SIGN_IN_UNLIMITED: value }, warn),
      ).toEqual({ skipAttemptsLimit: false });
      expect(warn).not.toHaveBeenCalled();
    },
  );

  it.each(['development', 'staging', 'production'])(
    'ignores the flag under %s and warns once',
    (appEnv) => {
      const warn = jest.fn();
      expect(
        signInLimitConfig(appEnv, { PR_QA_SIGN_IN_UNLIMITED: '1' }, warn),
      ).toEqual({ skipAttemptsLimit: false });
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0][0]).toMatch(/PR_QA_SIGN_IN_UNLIMITED/);
    },
  );

  it.each(['development', 'staging', 'production'])(
    'says nothing under %s when the flag is not set',
    (appEnv) => {
      const warn = jest.fn();
      expect(signInLimitConfig(appEnv, {}, warn)).toEqual({
        skipAttemptsLimit: false,
      });
      expect(warn).not.toHaveBeenCalled();
    },
  );
});
