import { verificationConfig } from './verification-config';

// @traces 207-FR-009

describe('verificationConfig', () => {
  it.each(['1', 'true'])(
    'turns the switch on for %s in a test environment',
    (value) => {
      expect(
        verificationConfig('test', { SKIP_MANUAL_APPROVAL: value }),
      ).toMatchObject({ skipManualApproval: true });
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

  // @traces 303-FR-004
  it.each(['test', 'development', 'staging'])(
    'lets the test-only platform rules be read under %s',
    (appEnv) => {
      expect(verificationConfig(appEnv, {}).testRules).toBe(true);
    },
  );

  // @traces 303-FR-004
  it('never reads the test-only platform rules in production', () => {
    expect(verificationConfig('production', {}).testRules).toBe(false);
  });
});
