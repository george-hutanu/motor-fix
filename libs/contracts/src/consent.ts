// The versions of the texts an account accepts when it is created. A new
// version of either text is a new date here; nothing else changes.
export const TERMS_VERSION = '2026-10-05';
export const PRIVACY_VERSION = '2026-10-05';

export const CURRENT_CONSENT = {
  privacyVersion: PRIVACY_VERSION,
  termsVersion: TERMS_VERSION,
} as const;

// The analytics consent text's version: a new date with each approved change
// of the bar's or the dialog's wording asks every visitor again. A choice
// older than the age below is asked again too.
export const ANALYTICS_CONSENT_VERSION = '2026-10-10';
export const ANALYTICS_CONSENT_MAX_AGE_DAYS = 365;
