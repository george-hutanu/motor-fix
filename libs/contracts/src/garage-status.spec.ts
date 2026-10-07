import {
  GARAGE_STATUS_LABELS,
  GARAGE_STATUSES,
  garageStatusKey,
  REAPPROVAL_FIELDS,
  statusLabel,
  VERIFICATION_FILE_STATUSES,
} from './garage-status';

// @traces 207-FR-006 207-FR-007 207-FR-011

const KEYS = [
  'draft',
  'sent',
  'under_review',
  'more_requested',
  'rejected',
  'approved',
  'suspended',
] as const;

const file = (
  status: (typeof VERIFICATION_FILE_STATUSES)[number],
  reason: { reasonCode: string | null; reasonNote: string | null } = {
    reasonCode: null,
    reasonNote: null,
  },
) => ({ status, ...reason });

describe('garageStatusKey', () => {
  it('lists the three garage statuses and the five file statuses', () => {
    expect([...GARAGE_STATUSES]).toEqual(['draft', 'approved', 'suspended']);
    expect([...VERIFICATION_FILE_STATUSES]).toEqual([
      'submitted',
      'in_review',
      'approved',
      'more_requested',
      'rejected',
    ]);
  });

  it('maps every garage status and newest file to exactly one of the seven keys', () => {
    for (const status of GARAGE_STATUSES) {
      for (const newest of [null, ...VERIFICATION_FILE_STATUSES]) {
        const { key } = garageStatusKey(
          { status },
          newest ? file(newest) : null,
        );

        expect(KEYS).toContain(key);
      }
    }
  });

  it.each([
    ['draft', null, 'draft'],
    ['draft', 'submitted', 'sent'],
    ['draft', 'in_review', 'under_review'],
    ['draft', 'more_requested', 'more_requested'],
    ['draft', 'rejected', 'rejected'],
  ] as const)(
    'shows a %s garage whose newest file is %s as %s',
    (status, newest, key) => {
      expect(
        garageStatusKey({ status }, newest ? file(newest) : null).key,
      ).toBe(key);
    },
  );

  it('shows an approved garage as approved whatever its newest file says', () => {
    for (const newest of VERIFICATION_FILE_STATUSES) {
      expect(garageStatusKey({ status: 'approved' }, file(newest)).key).toBe(
        'approved',
      );
    }
  });

  it('shows a suspended garage as suspended whatever its newest file says', () => {
    for (const newest of [null, ...VERIFICATION_FILE_STATUSES]) {
      expect(
        garageStatusKey({ status: 'suspended' }, newest ? file(newest) : null)
          .key,
      ).toBe('suspended');
    }
  });

  it("carries a rejection's reason code and note", () => {
    expect(
      garageStatusKey(
        { status: 'draft' },
        file('rejected', {
          reasonCode: 'documents_unreadable',
          reasonNote: 'The registration certificate is blurred',
        }),
      ),
    ).toEqual({
      key: 'rejected',
      reason: {
        code: 'documents_unreadable',
        note: 'The registration certificate is blurred',
      },
    });
  });

  it('carries no reason for any other state', () => {
    expect(
      garageStatusKey(
        { status: 'draft' },
        file('in_review', { reasonCode: 'old', reasonNote: 'kept on reopen' }),
      ),
    ).toEqual({ key: 'under_review' });
  });
});

describe('statusLabel', () => {
  it('has a label for each of the seven keys in Romanian and English', () => {
    for (const language of ['ro', 'en'] as const) {
      expect(Object.keys(GARAGE_STATUS_LABELS[language]).sort()).toEqual(
        [...KEYS].sort(),
      );
    }
  });

  it('uses the words of the mock in Romanian', () => {
    expect(GARAGE_STATUS_LABELS.ro).toEqual({
      approved: 'Aprobat, pe hartă',
      draft: 'Ciornă',
      more_requested: 'Cerute completări',
      rejected: 'Respins',
      sent: 'Trimis',
      suspended: 'Suspendat',
      under_review: 'În verificare',
    });
  });

  it('marks every state but approved as not published', () => {
    expect(statusLabel('sent', 'ro')).toBe('Trimis · nepublicat');
    expect(statusLabel('under_review', 'ro')).toBe(
      'În verificare · nepublicat',
    );
    expect(statusLabel('approved', 'ro')).toBe('Aprobat, pe hartă');
    expect(statusLabel('sent', 'en')).toBe(
      `${GARAGE_STATUS_LABELS.en.sent} · not published`,
    );
    expect(statusLabel('approved', 'en')).toBe('Approved, on the map');
    for (const key of KEYS.filter((k) => k !== 'approved')) {
      expect(statusLabel(key, 'ro')).toMatch(/ · nepublicat$/);
      expect(statusLabel(key, 'en')).toMatch(/ · not published$/);
    }
  });
});

describe('REAPPROVAL_FIELDS', () => {
  it('names the fields whose change needs a new approval', () => {
    expect([...REAPPROVAL_FIELDS]).toEqual([
      'cui',
      'address',
      'seat_address',
      'business_kind',
      'work_kinds',
    ]);
  });
});
