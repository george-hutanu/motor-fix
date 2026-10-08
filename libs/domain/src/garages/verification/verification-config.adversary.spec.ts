import { verificationConfig } from './verification-config';

describe('verificationConfig', () => {
  it.each(['1', 'true'])('skips manual approval under test for %s', (value) => {
    expect(verificationConfig('test', { SKIP_MANUAL_APPROVAL: value })).toEqual(
      { skipManualApproval: true },
    );
  });

  it.each(['production', 'staging', 'development', 'Test', 'test ', ''])(
    'ignores the switch under APP_ENV %j',
    (appEnv) => {
      expect(
        verificationConfig(appEnv, { SKIP_MANUAL_APPROVAL: 'true' })
          .skipManualApproval,
      ).toBe(false);
    },
  );

  it.each(['0', 'false', '', ' 1', 'yes', 'TRUE', '1 ', 'on'])(
    'does not skip for the value %j under test',
    (value) => {
      expect(
        verificationConfig('test', { SKIP_MANUAL_APPROVAL: value })
          .skipManualApproval,
      ).toBe(false);
    },
  );

  it('is off when the variable is absent', () => {
    expect(verificationConfig('test', {})).toEqual({
      skipManualApproval: false,
    });
  });
});
