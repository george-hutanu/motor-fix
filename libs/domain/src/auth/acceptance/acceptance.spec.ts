// @traces 1204-terms-reaccept-FR-001
import { PRIVACY_VERSION, TERMS_VERSION } from '@motor-fix/contracts';
import { HttpException } from '@nestjs/common';

import { consentPending, pendingAcceptance } from './acceptance';

const IN_FORCE = {
  privacyVersion: PRIVACY_VERSION,
  termsVersion: TERMS_VERSION,
};
const at = (day: number) => new Date(Date.UTC(2026, 9, day));
const row = (
  kind: 'terms' | 'privacy_notice',
  textVersion: string,
  day = 20,
) => ({ acceptedAt: at(day), kind, textVersion });

describe('pendingAcceptance', () => {
  it('is nothing when the latest row of each kind is the version in force', () => {
    expect(
      pendingAcceptance([
        row('terms', TERMS_VERSION),
        row('privacy_notice', PRIVACY_VERSION),
      ]),
    ).toBeNull();
  });

  it('names the versions in force when the terms row is older', () => {
    expect(
      pendingAcceptance([
        row('terms', '2026-10-11'),
        row('privacy_notice', PRIVACY_VERSION),
      ]),
    ).toEqual(IN_FORCE);
  });

  it('names the versions in force when the privacy notice row is older', () => {
    expect(
      pendingAcceptance([
        row('terms', TERMS_VERSION),
        row('privacy_notice', '2026-10-11'),
      ]),
    ).toEqual(IN_FORCE);
  });

  it('is pending when a kind has no row at all', () => {
    expect(pendingAcceptance([row('terms', TERMS_VERSION)])).toEqual(IN_FORCE);
    expect(pendingAcceptance([])).toEqual(IN_FORCE);
  });

  it('reads only the latest row of a kind, whatever order the rows come in', () => {
    expect(
      pendingAcceptance([
        row('terms', TERMS_VERSION, 1),
        row('terms', '2026-10-11', 22),
        row('privacy_notice', PRIVACY_VERSION),
      ]),
    ).toEqual(IN_FORCE);
    expect(
      pendingAcceptance([
        row('privacy_notice', PRIVACY_VERSION),
        row('terms', '2026-10-11', 1),
        row('terms', TERMS_VERSION, 22),
      ]),
    ).toBeNull();
  });
});

describe('consentPending', () => {
  it('is a 403 consent_required naming the versions in force', () => {
    const error = consentPending(IN_FORCE);

    expect(error).toBeInstanceOf(HttpException);
    expect(error.getStatus()).toBe(403);
    expect(error.getResponse()).toEqual({
      code: 'consent_required',
      message: expect.any(String),
      ...IN_FORCE,
    });
  });
});
