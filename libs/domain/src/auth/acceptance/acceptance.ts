import { PRIVACY_VERSION, TERMS_VERSION } from '@motor-fix/contracts';
import { HttpException, HttpStatus } from '@nestjs/common';

import type { Consent } from '../consent';

type AcceptanceRow = {
  acceptedAt: Date;
  kind: 'terms' | 'privacy_notice';
  textVersion: string;
};

const latest = (rows: readonly AcceptanceRow[], kind: AcceptanceRow['kind']) =>
  rows
    .filter((row) => row.kind === kind)
    .reduce<AcceptanceRow | undefined>(
      (newest, row) =>
        !newest || row.acceptedAt > newest.acceptedAt ? row : newest,
      undefined,
    )?.textVersion;

// The versions in force when the account's latest acceptance of either text
// is another version, or missing; null when both are accepted.
export function pendingAcceptance(
  rows: readonly AcceptanceRow[],
): Consent | null {
  if (
    latest(rows, 'terms') === TERMS_VERSION &&
    latest(rows, 'privacy_notice') === PRIVACY_VERSION
  )
    return null;
  return { privacyVersion: PRIVACY_VERSION, termsVersion: TERMS_VERSION };
}

export const consentPending = (versions: Consent) =>
  new HttpException(
    {
      code: 'consent_required',
      message: 'Accept the new terms of use and privacy notice to continue',
      ...versions,
    },
    HttpStatus.FORBIDDEN,
  );
