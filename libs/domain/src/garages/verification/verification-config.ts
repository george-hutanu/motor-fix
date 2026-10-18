export interface VerificationConfig {
  // Approve every submission at once, as the system. Test environments only.
  skipManualApproval: boolean;
  // Whether the test-only platform rules (skip_rar_check) are read at all;
  // false in production, where they never apply. Absent counts as false.
  testRules?: boolean;
}

export const VERIFICATION_CONFIG = Symbol('VERIFICATION_CONFIG');

// `SKIP_MANUAL_APPROVAL` is never required, and is ignored outside `test`.
export function verificationConfig(
  appEnv: string,
  source: Record<string, string | undefined>,
): VerificationConfig {
  const value = source['SKIP_MANUAL_APPROVAL'] ?? '';
  return {
    skipManualApproval: appEnv === 'test' && ['1', 'true'].includes(value),
    testRules: appEnv !== 'production',
  };
}
