interface SignInLimitConfig {
  // The signInAttempts route limit is not taken. The failure limits stay.
  skipAttemptsLimit: boolean;
}

// `PR_QA_SIGN_IN_UNLIMITED` is set only by the PR QA workflow, whose sweep
// signs in from one address at every size, scheme and language. It is
// honoured under APP_ENV=test only; set anywhere else it is ignored, with a
// warning, and the limit holds.
export function signInLimitConfig(
  appEnv: string,
  source: Record<string, string | undefined>,
  warn: (message: string) => void = console.warn,
): SignInLimitConfig {
  const on = ['1', 'true'].includes(source['PR_QA_SIGN_IN_UNLIMITED'] ?? '');
  if (on && appEnv !== 'test')
    warn(
      `PR_QA_SIGN_IN_UNLIMITED is ignored under APP_ENV=${appEnv}: the sign-in limit holds`,
    );
  return { skipAttemptsLimit: on && appEnv === 'test' };
}
