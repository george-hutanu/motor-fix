import { verificationConfig } from './verification-config';

describe('verificationConfig', () => {
  it.each(['1', 'true'])(
    'turns the switch on for %s in a test environment',
    (value) => {
      expect(
        verificationConfig('test', { SKIP_MANUAL_APPROVAL: value }),
      ).toEqual({ skipManualApproval: true });
    },
  );

  it.each([['yes'], ['0'], ['false'], [''], [undefined]])(
    'reads %s as off',
    (value) => {
      expect(
        verificationConfig('test', { SKIP_MANUAL_APPROVAL: value })
          .skipManualApproval,
      ).toBe(false);
    },
  );

  it.each(['development', 'staging', 'production'])(
    'ignores the switch under %s',
    (appEnv) => {
      expect(
        verificationConfig(appEnv, { SKIP_MANUAL_APPROVAL: 'true' })
          .skipManualApproval,
      ).toBe(false);
    },
  );
});
