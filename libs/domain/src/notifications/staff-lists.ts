import {
  type OutsideChannel,
  STAFF_CHANNELS,
  type StaffNotificationsDto,
  type StaffRole,
  type StaffSectionKey,
  type UpdateNotificationPreferenceDto,
} from '@motor-fix/contracts';

import { notificationType } from './catalogue';
import {
  isDriverChoice,
  mutedChannels,
  type PreferenceRow,
} from './preferences';

// The garage list and the admin list, section by section, in the order the
// panel shows them.
const SECTIONS: readonly { key: StaffSectionKey; types: readonly string[] }[] =
  [
    {
      key: 'requests_quotes',
      types: [
        'REQUEST_RECEIVED',
        'REQUEST_CANCELLED',
        'REQUEST_EXPIRED',
        'QUOTE_ACCEPTED',
        'QUOTE_LOST',
        'QUOTE_DECLINED_BY_DRIVER',
        'QUOTE_EXPIRED',
        'MESSAGE_RECEIVED',
      ],
    },
    {
      key: 'bookings',
      types: [
        'BOOKING_MOVE_REQUESTED',
        'BOOKING_CONFIRM_REMINDER',
        'BOOKING_MOVED',
        'BOOKING_CANCELLED',
        'BOOKING_LAPSED',
        'BOOKING_MOVE_LAPSED',
        'DAY_SHEET_OUTDATED',
        'DAY_SHEET_NOT_SENT',
      ],
    },
    {
      key: 'reviews',
      types: [
        'REVIEW_POSTED',
        'REVIEW_EDITED',
        'REVIEW_DECIDED',
        'REVIEW_APPEAL_DECIDED',
      ],
    },
    {
      key: 'account',
      types: [
        'VERIFICATION_RESULT',
        'GARAGE_SUSPENDED',
        'GARAGE_RESTORED',
        'DOCUMENT_DUE',
        'DOCUMENT_OVERDUE',
        'STAFF_JOINED',
        'CATALOGUE_JOB_DECIDED',
        'FACILITY_REMOVED',
        'FACILITY_RE_ADD_DECIDED',
      ],
    },
    {
      key: 'admin',
      types: [
        'ADMIN_VERIFICATION_QUEUED',
        'ADMIN_REVIEW_REPORTED',
        'ADMIN_APPEAL_RECEIVED',
        'ADMIN_OUTAGE_ALERT',
        'ADMIN_RULE_APPROVAL_NEEDED',
        'ADMIN_CATALOGUE_JOB_PENDING',
        'ADMIN_FACILITY_REQUEST',
        'ADMIN_RECHECK_DUE',
      ],
    },
  ];

const OWNER_ONLY = new Set([
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
]);
const DAY_SHEETS = new Set(['DAY_SHEET_OUTDATED', 'DAY_SHEET_NOT_SENT']);
const QUOTING = new Set(['REQUEST_RECEIVED', 'MESSAGE_RECEIVED']);

// Besides the e-mail of every always-sent type.
const ALSO_LOCKED: Readonly<Record<string, readonly OutsideChannel[]>> = {
  ADMIN_OUTAGE_ALERT: ['email', 'push'],
};

function gets(
  role: StaffRole,
  type: string,
  section: StaffSectionKey,
  { canAnswerQuotes = false, daySheets = true },
): boolean {
  if ((section === 'admin') !== (role === 'admin')) return false;
  switch (role) {
    case 'admin':
      return true;
    case 'mechanic':
      return type === 'BOOKING_MOVED' || (canAnswerQuotes && QUOTING.has(type));
    default:
      if (DAY_SHEETS.has(type) && !daySheets) return false;
      return role === 'owner' || !OWNER_ONLY.has(type);
  }
}

interface ListOptions {
  canAnswerQuotes?: boolean;
  daySheets?: boolean;
}

function sectionsFor(role: StaffRole, options: ListOptions) {
  return SECTIONS.map(({ key, types }) => ({
    key,
    types: types.filter((type) => gets(role, type, key, options)),
  })).filter((section) => section.types.length > 0);
}

// Every type some list holds, whoever the person is.
export const STAFF_TYPES: ReadonlySet<string> = new Set(
  SECTIONS.flatMap((section) => section.types),
);

export const staffTypes = (role: StaffRole, options: ListOptions = {}) =>
  sectionsFor(role, options).flatMap((section) => section.types);

export const locked = (type: string, channel: OutsideChannel) =>
  (notificationType(type).alwaysSent && channel === 'email') ||
  (ALSO_LOCKED[type]?.includes(channel) ?? false);

export interface StaffInput {
  memberships: readonly {
    garageId: string;
    garageName: string;
    role: 'owner' | 'receptionist';
  }[];
  mechanic: {
    garageId: string;
    garageName: string;
    canAnswerQuotes: boolean;
  } | null;
  admin: boolean;
  // A garage's switches; a missing one is on.
  features: readonly { garageId: string; key: string; enabled: boolean }[];
  phoneVerified: boolean;
  rows: readonly PreferenceRow[];
}

type Unavailable = StaffNotificationsDto['whatsapp']['reason'];

export function staffEntries(input: StaffInput): StaffNotificationsDto[] {
  const on = (garageId: string, key: string) =>
    input.features.find((f) => f.garageId === garageId && f.key === key)
      ?.enabled ?? true;
  const phone: Unavailable = input.phoneVerified ? null : 'phone_not_verified';
  const entry = (
    garageId: string | null,
    garageName: string | null,
    role: StaffRole,
    options: ListOptions,
    reason: Unavailable,
  ): StaffNotificationsDto => {
    const rows = input.rows.filter((r) => r.garageId === garageId);
    return {
      garageId,
      garageName,
      role,
      sections: sectionsFor(role, options).map(({ key, types }) => ({
        key,
        types: types.map((type) => {
          const muted = mutedChannels(type, rows, garageId);
          return {
            channels: STAFF_CHANNELS.filter((c) =>
              notificationType(type).channels.includes(c),
            ).map((channel) => {
              const isLocked = locked(type, channel);
              return {
                channel,
                enabled: isLocked || !muted.has(channel),
                locked: isLocked,
              };
            }),
            type,
          };
        }),
      })),
      whatsapp: { available: reason === null, reason },
    };
  };
  const garage = (garageId: string) =>
    on(garageId, 'whatsapp') ? phone : 'garage_whatsapp_off';
  const entries = input.memberships.map((m) =>
    entry(
      m.garageId,
      m.garageName,
      m.role,
      { daySheets: on(m.garageId, 'day_sheets') },
      garage(m.garageId),
    ),
  );
  const { mechanic } = input;
  if (
    mechanic &&
    !input.memberships.some((m) => m.garageId === mechanic.garageId)
  ) {
    entries.push(
      entry(
        mechanic.garageId,
        mechanic.garageName,
        'mechanic',
        { canAnswerQuotes: mechanic.canAnswerQuotes },
        garage(mechanic.garageId),
      ),
    );
  }
  if (input.admin) entries.push(entry(null, null, 'admin', {}, phone));
  return entries;
}

type StaffChoice = UpdateNotificationPreferenceDto;

interface Refusal {
  code:
    | 'type_not_in_list'
    | 'channel_locked'
    | 'whatsapp_unavailable'
    | 'last_channel';
  type: string;
}

type Listed = StaffNotificationsDto['sections'][number]['types'][number];

function listed(
  entries: readonly StaffNotificationsDto[],
  { garageId, type }: StaffChoice,
): { entry: StaffNotificationsDto; found: Listed } | null {
  const entry = entries.find((e) => e.garageId === garageId);
  const found = entry?.sections
    .flatMap((s) => s.types)
    .find((t) => t.type === type);
  return entry && found ? { entry, found } : null;
}

function refusal(
  entries: readonly StaffNotificationsDto[],
  choice: StaffChoice,
): Refusal['code'] | null {
  const { channel, enabled, type } = choice;
  const hit = listed(entries, choice);
  if (!hit) return 'type_not_in_list';
  if (!enabled && locked(type, channel)) {
    return 'channel_locked';
  }
  if (enabled && channel === 'whatsapp' && !hit.entry.whatsapp.available) {
    return 'whatsapp_unavailable';
  }
  return null;
}

// The first reason a save of staff choices is refused, judged against what
// the person may choose; a type kept to one channel is judged on the state
// the whole save leaves.
export function staffChecks(
  entries: readonly StaffNotificationsDto[],
  choices: readonly StaffChoice[],
): Refusal | null {
  const mine = choices.filter((c) => !isDriverChoice(c.type, c.garageId));
  for (const choice of mine) {
    const code = refusal(entries, choice);
    if (code) return { code, type: choice.type };
  }
  const after = new Map<string, { type: string; on: Map<string, boolean> }>();
  for (const choice of mine.filter((c) => notificationType(c.type).keepOne)) {
    const key = `${choice.garageId}:${choice.type}`;
    const channels = listed(entries, choice)?.found.channels ?? [];
    const state = after.get(key) ?? {
      on: new Map(channels.map((c) => [c.channel, c.enabled])),
      type: choice.type,
    };
    state.on.set(choice.channel, choice.enabled);
    after.set(key, state);
  }
  const off = [...after.values()].find(
    (state) => ![...state.on.values()].some(Boolean),
  );
  return off ? { code: 'last_channel', type: off.type } : null;
}
