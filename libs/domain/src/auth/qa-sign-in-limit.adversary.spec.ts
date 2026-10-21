import { signInLimitConfig } from './qa-sign-in-limit';

describe('signInLimitConfig with hostile input', () => {
  // @traces 1361-FR-008
  it.each([
    'TEST',
    'Test',
    ' test',
    'test ',
    'testing',
    'test\n',
    'contest',
    'test,production',
    '',
  ])(
    'keeps the limit and warns under the APP_ENV %j, which is not exactly test',
    (appEnv) => {
      const warn = jest.fn();
      expect(
        signInLimitConfig(appEnv, { PR_QA_SIGN_IN_UNLIMITED: '1' }, warn),
      ).toBe(false);
      expect(warn).toHaveBeenCalledTimes(1);
    },
  );

  // @traces 1361-FR-008
  it.each([
    '1 ',
    ' 1',
    '01',
    '11',
    '1\n',
    '１',
    'on',
    'yes',
    'enabled',
    '0',
    '-1',
    'TRUE',
    'True',
  ])('keeps the limit under APP_ENV=test for the flag value %j', (value) => {
    const warn = jest.fn();
    expect(
      signInLimitConfig('test', { PR_QA_SIGN_IN_UNLIMITED: value }, warn),
    ).toBe(false);
    expect(warn).not.toHaveBeenCalled();
  });

  // @traces 1361-FR-008
  it('lifts the limit only for the value 1, the one the PR QA workflow sets', () => {
    expect(
      signInLimitConfig('test', { PR_QA_SIGN_IN_UNLIMITED: 'true' }, jest.fn()),
    ).toBe(false);
  });
});
