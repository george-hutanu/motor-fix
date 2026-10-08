import type { PreferenceRow } from './preferences/preferences';
import {
  locked,
  type StaffInput,
  staffChecks,
  staffEntries,
  staffTypes,
} from './staff-lists';

const GARAGE = '0b7e4a52-9a5b-4c1a-8e3f-4a5b6d1f6a9c';
const OTHER = '6f1c2d3e-4b5a-4c6d-8e7f-9a0b1c2d3e4f';

const OWNER_ONLY = [
  'REVIEW_POSTED',
  'REVIEW_EDITED',
  'STAFF_JOINED',
  'VERIFICATION_RESULT',
  'GARAGE_SUSPENDED',
  'GARAGE_RESTORED',
  'DOCUMENT_DUE',
  'DOCUMENT_OVERDUE',
  'CATALOGUE_JOB_DECIDED',
  'FACILITY_REMOVED',
  'FACILITY_RE_ADD_DECIDED',
];

const OWNER = [
  'REQUEST_RECEIVED',
  'REQUEST_CANCELLED',
  'REQUEST_EXPIRED',
  'QUOTE_ACCEPTED',
  'QUOTE_LOST',
  'QUOTE_DECLINED_BY_DRIVER',
  'QUOTE_EXPIRED',
  'MESSAGE_RECEIVED',
  'BOOKING_MOVE_REQUESTED',
  'BOOKING_CONFIRM_REMINDER',
  'BOOKING_MOVED',
  'BOOKING_CANCELLED',
  'BOOKING_LAPSED',
  'BOOKING_MOVE_LAPSED',
  'DAY_SHEET_OUTDATED',
  'DAY_SHEET_NOT_SENT',
  'REVIEW_POSTED',
  'REVIEW_EDITED',
  'REVIEW_DECIDED',
  'REVIEW_APPEAL_DECIDED',
  'VERIFICATION_RESULT',
  'GARAGE_SUSPENDED',
  'GARAGE_RESTORED',
  'DOCUMENT_DUE',
  'DOCUMENT_OVERDUE',
  'STAFF_JOINED',
  'CATALOGUE_JOB_DECIDED',
  'FACILITY_REMOVED',
  'FACILITY_RE_ADD_DECIDED',
];

const ADMIN = [
  'ADMIN_VERIFICATION_QUEUED',
  'ADMIN_REVIEW_REPORTED',
  'ADMIN_APPEAL_RECEIVED',
  'ADMIN_OUTAGE_ALERT',
  'ADMIN_RULE_APPROVAL_NEEDED',
  'ADMIN_CATALOGUE_JOB_PENDING',
  'ADMIN_FACILITY_REQUEST',
  'ADMIN_RECHECK_DUE',
];

const NEVER = [
  'REQUEST_REMINDER',
  'DAY_SHEET',
  'DIRECT_REQUEST',
  'ADMIN_STATUS_ALERT',
];

const input = (over: Partial<StaffInput> = {}): StaffInput => ({
  admin: false,
  features: [],
  mechanic: null,
  memberships: [{ garageId: GARAGE, garageName: 'Atelier', role: 'owner' }],
  phoneVerified: true,
  rows: [],
  ...over,
});

const row = (
  type: string,
  channel: PreferenceRow['channel'],
  enabled: boolean,
  garageId: string | null = GARAGE,
): PreferenceRow => ({ channel, enabled, garageId, type });

type Entry = ReturnType<typeof staffEntries>[number];

const typesOf = (entry: Entry) =>
  entry.sections.flatMap((s) => s.types.map((t) => t.type));

const channelsOf = (entry: Entry, type: string) =>
  entry.sections.flatMap((s) => s.types).find((t) => t.type === type)?.channels;

// @traces 198-FR-004
describe('the types each role chooses for', () => {
  it('gives the owner the whole garage list in its order', () => {
    expect(staffTypes('owner', { daySheets: true })).toEqual(OWNER);
  });

  it('gives the receptionist the list without the owner’s own types', () => {
    expect(staffTypes('receptionist', { daySheets: true })).toEqual(
      OWNER.filter((t) => !OWNER_ONLY.includes(t)),
    );
  });

  it('gives a mechanic moved bookings, and requests and messages only when they answer quotes', () => {
    expect(staffTypes('mechanic', { canAnswerQuotes: false })).toEqual([
      'BOOKING_MOVED',
    ]);
    expect(staffTypes('mechanic', { canAnswerQuotes: true })).toEqual([
      'REQUEST_RECEIVED',
      'MESSAGE_RECEIVED',
      'BOOKING_MOVED',
    ]);
  });

  it('gives an admin the eight admin types', () => {
    expect(staffTypes('admin')).toEqual(ADMIN);
  });

  it('never lists a reminder, the day sheet, a direct request or a status alert', () => {
    for (const role of [
      'owner',
      'receptionist',
      'mechanic',
      'admin',
    ] as const) {
      const types = staffTypes(role, {
        canAnswerQuotes: true,
        daySheets: true,
      });
      for (const name of NEVER) expect(types).not.toContain(name);
    }
  });

  // @traces 198-FR-004 198-FR-005
  it('drops exactly the two day sheet types while day sheets are off', () => {
    for (const role of ['owner', 'receptionist'] as const) {
      const on = staffTypes(role, { daySheets: true });
      const off = staffTypes(role, { daySheets: false });
      expect(on.filter((t) => !off.includes(t))).toEqual([
        'DAY_SHEET_OUTDATED',
        'DAY_SHEET_NOT_SENT',
      ]);
    }
  });
});

// @traces 198-FR-006
describe('a locked channel', () => {
  it('is the e-mail of an always-sent type', () => {
    expect(locked('VERIFICATION_RESULT', 'email')).toBe(true);
    expect(locked('BOOKING_CANCELLED', 'email')).toBe(true);
    expect(locked('BOOKING_CANCELLED', 'push')).toBe(false);
    expect(locked('FACILITY_REMOVED', 'whatsapp')).toBe(false);
  });

  it('is e-mail and push of an outage alert', () => {
    expect(locked('ADMIN_OUTAGE_ALERT', 'email')).toBe(true);
    expect(locked('ADMIN_OUTAGE_ALERT', 'push')).toBe(true);
  });

  it('is never a document reminder’s channel or a plain type’s', () => {
    for (const channel of ['email', 'push', 'whatsapp'] as const) {
      expect(locked('DOCUMENT_DUE', channel)).toBe(false);
      expect(locked('DOCUMENT_OVERDUE', channel)).toBe(false);
      expect(locked('REQUEST_RECEIVED', channel)).toBe(false);
    }
  });
});

describe('the staff entries a person reads', () => {
  it('are empty for someone who is no staff and no admin', () => {
    expect(staffEntries(input({ memberships: [] }))).toEqual([]);
  });

  // @traces 198-FR-001 198-FR-002
  it('give one entry per garage and one with no garage for an admin', () => {
    const entries = staffEntries(
      input({
        admin: true,
        memberships: [
          { garageId: GARAGE, garageName: 'Atelier', role: 'owner' },
          { garageId: OTHER, garageName: 'Vulcan', role: 'receptionist' },
        ],
      }),
    );
    expect(entries.map((e) => [e.garageId, e.garageName, e.role])).toEqual([
      [GARAGE, 'Atelier', 'owner'],
      [OTHER, 'Vulcan', 'receptionist'],
      [null, null, 'admin'],
    ]);
    expect(entries[2].sections.map((s) => s.key)).toEqual(['admin']);
    expect(typesOf(entries[2])).toEqual(ADMIN);
  });

  // @traces 198-FR-005
  it('list a mechanic’s garage with only the sections it has types in', () => {
    const [entry] = staffEntries(
      input({
        mechanic: { canAnswerQuotes: false, garageId: GARAGE, garageName: 'A' },
        memberships: [],
      }),
    );
    expect(entry.role).toBe('mechanic');
    expect(entry.sections.map((s) => s.key)).toEqual(['bookings']);
    expect(typesOf(entry)).toEqual(['BOOKING_MOVED']);
  });

  // @traces 198-FR-005
  it('group the owner’s types into the four garage sections', () => {
    const [entry] = staffEntries(input());
    expect(entry.sections.map((s) => s.key)).toEqual([
      'requests_quotes',
      'bookings',
      'reviews',
      'account',
    ]);
    expect(typesOf(entry)).toEqual(OWNER);
  });

  it('leave the day sheet types out while the garage turned day sheets off', () => {
    const [entry] = staffEntries(
      input({
        features: [{ enabled: false, garageId: GARAGE, key: 'day_sheets' }],
      }),
    );
    expect(typesOf(entry)).not.toContain('DAY_SHEET_OUTDATED');
    expect(typesOf(entry)).not.toContain('DAY_SHEET_NOT_SENT');
  });

  // @traces 198-FR-003
  it('give e-mail, push and WhatsApp where the catalogue does, never SMS', () => {
    const [entry] = staffEntries(input());
    expect(
      channelsOf(entry, 'REQUEST_RECEIVED')?.map((c) => c.channel),
    ).toEqual(['email', 'push', 'whatsapp']);
    expect(channelsOf(entry, 'DAY_SHEET_OUTDATED')).toEqual([]);
    expect(
      channelsOf(entry, 'DAY_SHEET_NOT_SENT')?.map((c) => c.channel),
    ).toEqual(['email']);
  });

  // @traces 198-FR-003
  it('read on by default and WhatsApp off until turned on', () => {
    const [entry] = staffEntries(input());
    expect(channelsOf(entry, 'REQUEST_RECEIVED')).toEqual([
      { channel: 'email', enabled: true, locked: false },
      { channel: 'push', enabled: true, locked: false },
      { channel: 'whatsapp', enabled: false, locked: false },
    ]);
  });

  it('read what is saved for that garage only', () => {
    const entries = staffEntries(
      input({
        memberships: [
          { garageId: GARAGE, garageName: 'Atelier', role: 'owner' },
          { garageId: OTHER, garageName: 'Vulcan', role: 'owner' },
        ],
        rows: [
          row('REQUEST_RECEIVED', 'push', false),
          row('REQUEST_RECEIVED', 'whatsapp', true),
          row('REQUEST_RECEIVED', 'email', false, null),
        ],
      }),
    );
    expect(channelsOf(entries[0], 'REQUEST_RECEIVED')).toEqual([
      { channel: 'email', enabled: true, locked: false },
      { channel: 'push', enabled: false, locked: false },
      { channel: 'whatsapp', enabled: true, locked: false },
    ]);
    expect(
      channelsOf(entries[1], 'REQUEST_RECEIVED')?.map((c) => c.enabled),
    ).toEqual([true, true, false]);
  });

  // @traces 198-FR-003 198-FR-006
  it('read a locked channel as on whatever a row says', () => {
    const [entry] = staffEntries(
      input({ rows: [row('VERIFICATION_RESULT', 'email', false)] }),
    );
    expect(channelsOf(entry, 'VERIFICATION_RESULT')?.[0]).toEqual({
      channel: 'email',
      enabled: true,
      locked: true,
    });
  });

  it('keep a driver choice of the same type apart from the garage’s rows', () => {
    const [entry] = staffEntries(
      input({ rows: [row('BOOKING_MOVED', 'push', true, null)] }),
    );
    expect(channelsOf(entry, 'BOOKING_MOVED')?.map((c) => c.enabled)).toEqual([
      true,
      true,
      false,
    ]);
  });

  // @traces 198-FR-002
  describe('say whether WhatsApp can be chosen', () => {
    it('can when the garage has it and the phone is verified', () => {
      const [entry] = staffEntries(input());
      expect(entry.whatsapp).toEqual({ available: true, reason: null });
    });

    it('cannot while the garage turned it off, said before the phone', () => {
      const [entry] = staffEntries(
        input({
          features: [{ enabled: false, garageId: GARAGE, key: 'whatsapp' }],
          phoneVerified: false,
        }),
      );
      expect(entry.whatsapp).toEqual({
        available: false,
        reason: 'garage_whatsapp_off',
      });
    });

    it('cannot without a verified phone, and keeps the saved choice', () => {
      const [entry] = staffEntries(
        input({
          phoneVerified: false,
          rows: [row('REQUEST_RECEIVED', 'whatsapp', true)],
        }),
      );
      expect(entry.whatsapp).toEqual({
        available: false,
        reason: 'phone_not_verified',
      });
      expect(channelsOf(entry, 'REQUEST_RECEIVED')?.[2].enabled).toBe(true);
    });

    it('depends on the phone alone for an admin', () => {
      const entries = staffEntries(
        input({
          admin: true,
          features: [{ enabled: false, garageId: GARAGE, key: 'whatsapp' }],
          memberships: [],
        }),
      );
      expect(entries[0].whatsapp).toEqual({ available: true, reason: null });
    });
  });
});

// @traces 198-FR-008
describe('the checks on a staff save', () => {
  const entries = (over: Partial<StaffInput> = {}) => staffEntries(input(over));
  const choice = (
    type: string,
    channel: PreferenceRow['channel'],
    enabled: boolean,
    garageId: string | null = GARAGE,
  ) => ({ channel, enabled, garageId, type });

  it('pass a choice inside the list', () => {
    expect(
      staffChecks(entries(), [choice('REQUEST_RECEIVED', 'push', false)]),
    ).toBeNull();
  });

  it('pass a driver choice, which is no staff choice', () => {
    expect(
      staffChecks(entries(), [choice('QUOTE_RECEIVED', 'push', true, null)]),
    ).toBeNull();
  });

  it('refuse a type outside the caller’s list for that garage', () => {
    const receptionist = entries({
      memberships: [
        { garageId: GARAGE, garageName: 'A', role: 'receptionist' },
      ],
    });
    expect(
      staffChecks(receptionist, [choice('REVIEW_POSTED', 'email', false)]),
    ).toEqual({ code: 'type_not_in_list', type: 'REVIEW_POSTED' });
  });

  it('refuse an admin type from someone who is not an admin', () => {
    expect(
      staffChecks(entries(), [
        choice('ADMIN_RECHECK_DUE', 'email', false, null),
      ]),
    ).toEqual({ code: 'type_not_in_list', type: 'ADMIN_RECHECK_DUE' });
  });

  it('refuse a locked channel switched off', () => {
    expect(
      staffChecks(entries(), [choice('VERIFICATION_RESULT', 'email', false)]),
    ).toEqual({ code: 'channel_locked', type: 'VERIFICATION_RESULT' });
    expect(
      staffChecks(entries(), [choice('VERIFICATION_RESULT', 'push', false)]),
    ).toBeNull();
  });

  it('refuse WhatsApp turned on where it cannot be chosen, but not turned off', () => {
    const noPhone = entries({ phoneVerified: false });
    expect(
      staffChecks(noPhone, [choice('REQUEST_RECEIVED', 'whatsapp', true)]),
    ).toEqual({ code: 'whatsapp_unavailable', type: 'REQUEST_RECEIVED' });
    expect(
      staffChecks(noPhone, [choice('REQUEST_RECEIVED', 'whatsapp', false)]),
    ).toBeNull();
  });

  it('refuse a document reminder left with no channel on', () => {
    expect(
      staffChecks(entries(), [
        choice('DOCUMENT_DUE', 'email', false),
        choice('DOCUMENT_DUE', 'push', false),
      ]),
    ).toEqual({ code: 'last_channel', type: 'DOCUMENT_DUE' });
  });

  it('judge the last channel on the state the whole save leaves', () => {
    const pushOnly = entries({
      rows: [row('DOCUMENT_OVERDUE', 'push', false)],
    });
    expect(
      staffChecks(pushOnly, [
        choice('DOCUMENT_OVERDUE', 'push', true),
        choice('DOCUMENT_OVERDUE', 'email', false),
      ]),
    ).toBeNull();
    expect(
      staffChecks(entries(), [
        choice('DOCUMENT_DUE', 'email', false),
        choice('DOCUMENT_DUE', 'email', true),
        choice('DOCUMENT_DUE', 'push', false),
      ]),
    ).toBeNull();
  });
});
