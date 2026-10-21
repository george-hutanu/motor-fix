// Whether the signInAttempts route limit is skipped; the failure limits stay.
// `PR_QA_SIGN_IN_UNLIMITED=1` is set only by the PR QA workflow, whose sweep
// signs in from one address at every size, scheme and language. Only the
// value `1` counts, and only under APP_ENV=test; set anywhere else it is
// ignored, with a warning, and the limit holds.
export function signInLimitConfig(
  appEnv: string,
  source: Record<string, string | undefined>,
  warn: (message: string) => void = console.warn,
): boolean {
  const on = source['PR_QA_SIGN_IN_UNLIMITED'] === '1';
  if (on && appEnv !== 'test')
    warn(
      `PR_QA_SIGN_IN_UNLIMITED is ignored under APP_ENV=${appEnv}: the sign-in limit holds`,
    );
  return on && appEnv === 'test';
}
