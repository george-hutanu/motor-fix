import { PRIVACY_VERSION, TERMS_VERSION } from '@motor-fix/contracts';
import { HttpException, HttpStatus } from '@nestjs/common';

// What every path that creates an account must carry: the versions of the
// terms of use and the privacy notice the person accepted.
export type Consent = { termsVersion: string; privacyVersion: string };

export const isCurrentConsent = (consent: unknown): consent is Consent =>
  typeof consent === 'object' &&
  consent !== null &&
  (consent as Partial<Consent>).termsVersion === TERMS_VERSION &&
  (consent as Partial<Consent>).privacyVersion === PRIVACY_VERSION;

export const consentRequired = () =>
  new HttpException(
    {
      code: 'consent_required',
      errors: [{ code: 'consent_required', field: 'consent' }],
      message: 'Accept the current terms of use and privacy notice',
    },
    HttpStatus.BAD_REQUEST,
  );
