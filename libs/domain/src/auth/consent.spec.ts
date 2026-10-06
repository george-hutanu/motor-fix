import {
  CURRENT_CONSENT,
  PRIVACY_VERSION,
  TERMS_VERSION,
} from '@motor-fix/contracts';
import { HttpStatus } from '@nestjs/common';

import { consentRequired, isCurrentConsent } from './consent';

describe('isCurrentConsent', () => {
  it('accepts the current terms and privacy versions', () => {
    expect(isCurrentConsent(CURRENT_CONSENT)).toBe(true);
    expect(
      isCurrentConsent({
        privacyVersion: PRIVACY_VERSION,
        termsVersion: TERMS_VERSION,
      }),
    ).toBe(true);
  });

  it.each([
    ['nothing', undefined],
    ['null', null],
    ['an empty object', {}],
    ['only the terms', { termsVersion: TERMS_VERSION }],
    ['only the privacy notice', { privacyVersion: PRIVACY_VERSION }],
    ['an old terms version', { ...CURRENT_CONSENT, termsVersion: 'x' }],
    ['an old privacy version', { ...CURRENT_CONSENT, privacyVersion: 'x' }],
    ['the versions swapped', { privacyVersion: 'a', termsVersion: 'b' }],
  ])('refuses %s', (_, consent) => {
    expect(isCurrentConsent(consent)).toBe(false);
  });
});

describe('consentRequired', () => {
  it('is a 400 consent_required on the consent field', () => {
    const error = consentRequired();

    expect(error.getStatus()).toBe(HttpStatus.BAD_REQUEST);
    expect(error.getResponse()).toMatchObject({
      code: 'consent_required',
      errors: [{ code: 'consent_required', field: 'consent' }],
    });
  });
});
