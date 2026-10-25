import { PRIVACY_VERSION, TERMS_VERSION } from '@motor-fix/contracts';

import { consentPending, pendingAcceptance } from './acceptance';

const IN_FORCE = {
  privacyVersion: PRIVACY_VERSION,
  termsVersion: TERMS_VERSION,
};
const at = (ms: number) => new Date(ms);
const row = (
  kind: 'terms' | 'privacy_notice',
  textVersion: string,
  ms = 1_000,
) => ({ acceptedAt: at(ms), kind, textVersion });

describe('pendingAcceptance at its edges', () => {
  // @traces 1204-FR-001
  it('is pending when only privacy rows exist, however many', () => {
    expect(
      pendingAcceptance([
        row('privacy_notice', PRIVACY_VERSION, 1),
        row('privacy_notice', PRIVACY_VERSION, 2),
      ]),
    ).toEqual(IN_FORCE);
  });

  // @traces 1204-FR-001
  it('does not let a current terms row stand in for the privacy notice', () => {
    expect(
      pendingAcceptance([
        row('terms', TERMS_VERSION),
        row('terms', PRIVACY_VERSION, 5),
      ]),
    ).toEqual(IN_FORCE);
  });

  // @traces 1204-FR-001
  it('is pending when the version in force is only a prefix or a case variant of the stored one', () => {
    expect(
      pendingAcceptance([
        row('terms', `${TERMS_VERSION} `),
        row('privacy_notice', PRIVACY_VERSION),
      ]),
    ).toEqual(IN_FORCE);
    expect(
      pendingAcceptance([
        row('terms', TERMS_VERSION),
        row('privacy_notice', PRIVACY_VERSION.slice(0, -1)),
      ]),
    ).toEqual(IN_FORCE);
  });

  // @traces 1204-FR-001
  it('is pending when the newest row is older than a stale one by one millisecond', () => {
    expect(
      pendingAcceptance([
        row('terms', TERMS_VERSION, 1_000),
        row('terms', '2026-10-11', 1_001),
        row('privacy_notice', PRIVACY_VERSION),
      ]),
    ).toEqual(IN_FORCE);
  });

  // @traces 1204-FR-001
  it('is clear once the same acceptance is stored ten thousand times', () => {
    const rows = Array.from({ length: 10_000 }, (_, i) =>
      row(
        i % 2 ? 'terms' : 'privacy_notice',
        i % 2 ? TERMS_VERSION : PRIVACY_VERSION,
        i,
      ),
    );

    expect(pendingAcceptance(rows)).toBeNull();
  });

  // @traces 1204-FR-001
  it('is idempotent and leaves the rows as they were', () => {
    const rows = [row('terms', '2026-10-11')];
    const copy = structuredClone(rows);

    expect(pendingAcceptance(rows)).toEqual(pendingAcceptance(rows));
    expect(rows).toEqual(copy);
  });

  // @traces 1204-FR-001
  it('ignores a row of an unknown kind', () => {
    const alien = {
      acceptedAt: at(9_999),
      kind: 'cookies' as 'terms',
      textVersion: TERMS_VERSION,
    };

    expect(
      pendingAcceptance([alien, row('privacy_notice', PRIVACY_VERSION)]),
    ).toEqual(IN_FORCE);
  });
});

describe('consentPending body', () => {
  // @traces 1204-FR-002
  it('carries exactly code, message and the two versions', () => {
    const body = consentPending(IN_FORCE).getResponse() as Record<
      string,
      unknown
    >;

    expect(Object.keys(body).sort()).toEqual([
      'code',
      'message',
      'privacyVersion',
      'termsVersion',
    ]);
  });
});
