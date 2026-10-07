export const GARAGE_STATUSES = ['draft', 'approved', 'suspended'] as const;
export type GarageStatus = (typeof GARAGE_STATUSES)[number];

export const VERIFICATION_FILE_STATUSES = [
  'submitted',
  'in_review',
  'approved',
  'more_requested',
  'rejected',
] as const;
export type VerificationFileStatus =
  (typeof VERIFICATION_FILE_STATUSES)[number];

export type GarageStatusKey =
  | 'draft'
  | 'sent'
  | 'under_review'
  | 'more_requested'
  | 'rejected'
  | 'approved'
  | 'suspended';

const BY_FILE: Record<VerificationFileStatus, GarageStatusKey> = {
  approved: 'draft',
  in_review: 'under_review',
  more_requested: 'more_requested',
  rejected: 'rejected',
  submitted: 'sent',
};

// What the garage is shown, derived and never stored: the garage's own
// status first, then its newest file. A draft garage with an approved file
// cannot happen (the approval publishes it); it reads as a draft.
export function garageStatusKey(
  garage: { status: GarageStatus },
  newestFile: {
    status: VerificationFileStatus;
    reasonCode: string | null;
    reasonNote: string | null;
  } | null,
): { key: GarageStatusKey; reason?: { code: string; note: string } } {
  if (garage.status !== 'draft') return { key: garage.status };
  if (!newestFile) return { key: 'draft' };
  const key = BY_FILE[newestFile.status];
  if (key !== 'rejected') return { key };
  return {
    key,
    reason: {
      code: newestFile.reasonCode ?? '',
      note: newestFile.reasonNote ?? '',
    },
  };
}

export const GARAGE_STATUS_LABELS: Record<
  'ro' | 'en',
  Record<GarageStatusKey, string>
> = {
  en: {
    approved: 'Approved, on the map',
    draft: 'Draft',
    more_requested: 'More details requested',
    rejected: 'Rejected',
    sent: 'Sent',
    suspended: 'Suspended',
    under_review: 'Under review',
  },
  ro: {
    approved: 'Aprobat, pe hartă',
    draft: 'Ciornă',
    more_requested: 'Cerute completări',
    rejected: 'Respins',
    sent: 'Trimis',
    suspended: 'Suspendat',
    under_review: 'În verificare',
  },
};

const UNPUBLISHED = { en: ' · not published', ro: ' · nepublicat' } as const;

export function statusLabel(key: GarageStatusKey, language: 'ro' | 'en') {
  const label = GARAGE_STATUS_LABELS[language][key];
  return key === 'approved' ? label : `${label}${UNPUBLISHED[language]}`;
}

// The profile fields whose change sends an approved garage back for approval.
export const REAPPROVAL_FIELDS = [
  'cui',
  'address',
  'seat_address',
  'business_kind',
  'work_kinds',
] as const;
