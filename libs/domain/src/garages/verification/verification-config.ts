export interface VerificationConfig {
  // Approve every submission at once, as the system. Test environments only.
  skipManualApproval: boolean;
  // The web app's address, for the admins' alert link; unset, none is sent.
  webUrl?: string;
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
  };
}
