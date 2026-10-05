// The versions of the texts an account accepts when it is created. A new
// version of either text is a new date here; nothing else changes.
export const TERMS_VERSION = '2026-10-05';
export const PRIVACY_VERSION = '2026-10-05';

export const CURRENT_CONSENT = {
  privacyVersion: PRIVACY_VERSION,
  termsVersion: TERMS_VERSION,
} as const;
