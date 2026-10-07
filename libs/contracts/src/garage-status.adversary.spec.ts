import {
  GARAGE_STATUS_LABELS,
  type GarageStatusKey,
  garageStatusKey,
  REAPPROVAL_FIELDS,
  statusLabel,
} from './garage-status';

const KEYS: GarageStatusKey[] = [
  'draft',
  'sent',
  'under_review',
  'more_requested',
  'rejected',
  'approved',
  'suspended',
];

describe('garageStatusKey', () => {
  it('shows a suspended garage as suspended whatever its newest file says', () => {
    const rejected = {
      reasonCode: 'x',
      reasonNote: 'y',
      status: 'rejected',
    } as const;

    expect(garageStatusKey({ status: 'suspended' }, rejected)).toEqual({
      key: 'suspended',
    });
  });

  it('shows an approved garage as approved even when a newer file is under review', () => {
    expect(
      garageStatusKey(
        { status: 'approved' },
        { reasonCode: null, reasonNote: null, status: 'in_review' },
      ),
    ).toEqual({ key: 'approved' });
  });

  it('carries no reason on a more_requested draft', () => {
    expect(
      garageStatusKey(
        { status: 'draft' },
        { reasonCode: 'a', reasonNote: 'b', status: 'more_requested' },
      ),
    ).toEqual({ key: 'more_requested' });
  });

  it('carries the rejection reason of a draft garage verbatim', () => {
    expect(
      garageStatusKey(
        { status: 'draft' },
        {
          reasonCode: 'cui_invalid',
          reasonNote: 'Ștefan — "CUI"',
          status: 'rejected',
        },
      ),
    ).toEqual({
      key: 'rejected',
      reason: { code: 'cui_invalid', note: 'Ștefan — "CUI"' },
    });
  });
});

describe('statusLabel', () => {
  it.each(['ro', 'en'] as const)(
    'adds the unpublished suffix to every %s label but approved',
    (language) => {
      for (const key of KEYS) {
        const base = GARAGE_STATUS_LABELS[language][key];
        expect(statusLabel(key, language)).toBe(
          key === 'approved'
            ? base
            : `${base} · ${language === 'en' ? 'not published' : 'nepublicat'}`,
        );
      }
    },
  );

  it('has a distinct non-empty label for each key in both languages', () => {
    for (const language of ['ro', 'en'] as const) {
      const labels = KEYS.map((key) => GARAGE_STATUS_LABELS[language][key]);
      expect(new Set(labels).size).toBe(KEYS.length);
      expect(labels.every((label) => label.length > 0)).toBe(true);
    }
  });
});

describe('REAPPROVAL_FIELDS', () => {
  it('lists exactly the five fields that send an approved garage back', () => {
    expect([...REAPPROVAL_FIELDS].sort()).toEqual(
      ['address', 'business_kind', 'cui', 'seat_address', 'work_kinds'].sort(),
    );
  });
});
