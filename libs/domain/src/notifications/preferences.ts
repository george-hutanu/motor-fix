import {
  type NotificationGroupKey as DriverGroup,
  NEWS_CONSENT_TEXT_VERSION,
  type NewsConsentDto,
  NOTIFICATION_GROUPS,
  type OutsideChannel,
} from '@motor-fix/contracts';

import { NOTIFICATION_TYPES, notificationType } from './catalogue';

export interface PreferenceRow {
  type: string;
  channel: OutsideChannel;
  enabled: boolean;
  garageId: string | null;
}

const NAMES = Object.keys(NOTIFICATION_TYPES);

const groupTypes = (group: DriverGroup) =>
  NAMES.filter((name) => NOTIFICATION_TYPES[name].group === group);

const isDriverType = (name: string) => notificationType(name).group !== null;

// A driver choice is one row, its chosen channel: no garage and a type of a
// driver group. Any other row (a garage's, or an admin type) is per channel.
export const isDriverChoice = (name: string, garageId: string | null) =>
  garageId === null && isDriverType(name);

export const canMute = (name: string) => {
  const type = notificationType(name);
  return !type.alwaysSent && !type.transactional;
};

const enabledByDefault = (name: string) => name !== 'NEWS';

// What a driver type is when nothing is saved: every driver type allows e-mail.
function driverChoice(
  name: string,
  rows: readonly PreferenceRow[],
): { channel: OutsideChannel; enabled: boolean } {
  const saved = rows.find((r) => r.type === name && r.garageId === null);
  return saved
    ? { channel: saved.channel, enabled: saved.enabled }
    : { channel: 'email', enabled: enabledByDefault(name) };
}

const driverTypes = NAMES.filter(isDriverType);

// A group is on when every type of it that can be muted is enabled.
const groupOn = (key: DriverGroup, rows: readonly PreferenceRow[]) =>
  groupTypes(key)
    .filter(canMute)
    .every((name) => driverChoice(name, rows).enabled);

export function preferencesView(rows: readonly PreferenceRow[]) {
  const groups = NOTIFICATION_GROUPS.map((key) => ({
    enabled: groupOn(key, rows),
    key,
    types: groupTypes(key),
  }));
  const driver = driverTypes.map((type) => ({
    alwaysSent: !canMute(type),
    ...driverChoice(type, rows),
    garageId: null,
    type,
  }));
  const staff = rows
    .filter((r) => !isDriverChoice(r.type, r.garageId))
    .map((r) => ({
      alwaysSent: !canMute(r.type),
      channel: r.channel,
      enabled: r.enabled,
      garageId: r.garageId,
      type: r.type,
    }));
  return { groups, preferences: [...driver, ...staff] };
}

// A request's reminders follow the request's own rows.
export const rowsType = (name: string) =>
  name === 'REQUEST_REMINDER' ? 'REQUEST_RECEIVED' : name;

// Staff WhatsApp is off until the person turns it on, unless the type goes by
// nothing else.
function staffEnabled(
  name: string,
  channel: OutsideChannel,
  rows: readonly PreferenceRow[],
): boolean {
  const { channels } = notificationType(name);
  const saved = rows.find(
    (r) => r.type === rowsType(name) && r.channel === channel,
  );
  const optIn =
    channel === 'whatsapp' && channels.some((other) => other !== 'whatsapp');
  return optIn ? saved?.enabled === true : saved?.enabled !== false;
}

// The outside channels a message of this type must not go by, from the
// person's rows for it (already narrowed to the message's garage).
export function mutedChannels(
  name: string,
  rows: readonly PreferenceRow[],
  garageId: string | null = null,
): Set<OutsideChannel> {
  const { channels } = notificationType(name);
  if (isDriverChoice(name, garageId)) {
    const { channel, enabled } = driverChoice(name, rows);
    return new Set(channels.filter((c) => !enabled || c !== channel));
  }
  return new Set(channels.filter((c) => !staffEnabled(name, c, rows)));
}

// One audit entry: the group or the type (with its channel), old and new.
export interface PreferenceChange {
  field: string;
  oldValue: unknown;
  newValue: unknown;
  garageId?: string;
}

interface Plan {
  rows: PreferenceRow[];
  writes: PreferenceRow[];
  changes: PreferenceChange[];
}

const sameRow = (a: PreferenceRow, b: PreferenceRow) =>
  a.type === b.type &&
  a.garageId === b.garageId &&
  (isDriverChoice(a.type, a.garageId) || a.channel === b.channel);

function put(plan: Plan, next: PreferenceRow) {
  plan.rows = [...plan.rows.filter((r) => !sameRow(r, next)), next];
  plan.writes.push(next);
}

// Always-sent types of the group are left as they are. A switch is recorded
// when it changed a type, even if the group already read as switched.
function switchGroup(plan: Plan, key: DriverGroup, enabled: boolean) {
  const before = groupOn(key, plan.rows);
  const written = plan.writes.length;
  for (const type of groupTypes(key).filter(canMute)) {
    const was = driverChoice(type, plan.rows);
    if (was.enabled !== enabled) {
      put(plan, { channel: was.channel, enabled, garageId: null, type });
    }
  }
  if (before === enabled && plan.writes.length === written) return;
  plan.changes.push({
    field: `group.${key}`,
    newValue: enabled,
    oldValue: before,
  });
}

function choose(plan: Plan, choice: PreferenceRow) {
  const { channel, enabled, garageId, type } = choice;
  if (isDriverChoice(type, garageId)) {
    const was = driverChoice(type, plan.rows);
    if (was.channel === channel && was.enabled === enabled) return;
    put(plan, choice);
    plan.changes.push({
      field: type,
      newValue: { channel, enabled },
      oldValue: was,
    });
    return;
  }
  const was = staffEnabled(
    type,
    channel,
    plan.rows.filter((r) => r.garageId === garageId),
  );
  if (was === enabled) return;
  put(plan, choice);
  plan.changes.push({
    field: `${type}.${channel}`,
    garageId: garageId ?? undefined,
    newValue: enabled,
    oldValue: was,
  });
}

// What a save writes and records, from the rows saved before it: the group
// switches first, then the choices for single types.
export function planSave(
  rows: readonly PreferenceRow[],
  groups: readonly { key: DriverGroup; enabled: boolean }[],
  choices: readonly PreferenceRow[],
): { writes: PreferenceRow[]; changes: PreferenceChange[] } {
  const plan: Plan = { changes: [], rows: [...rows], writes: [] };
  for (const { key, enabled } of groups) switchGroup(plan, key, enabled);
  for (const choice of choices) choose(plan, choice);
  return { changes: plan.changes, writes: plan.writes };
}

// The NEWS row's record of the driver's consent.
export interface NewsConsent {
  consentGivenAt: Date | null;
  consentTextVersion: string | null;
  consentSource: string | null;
  withdrawnAt: Date | null;
}

const consentState = (row: NewsConsent | null) =>
  !row?.consentGivenAt ? 'none' : row.withdrawnAt ? 'withdrawn' : 'given';

export const newsConsentView = (row: NewsConsent | null): NewsConsentDto => ({
  currentTextVersion: NEWS_CONSENT_TEXT_VERSION,
  givenAt: row?.consentGivenAt?.toISOString() ?? null,
  state: consentState(row),
  textVersion: row?.consentTextVersion ?? null,
  withdrawnAt: row?.withdrawnAt?.toISOString() ?? null,
});

// Withdrawing keeps when and to which text consent was given; a row that never
// had consent has nothing to withdraw.
export const withdrawn = (row: NewsConsent | null, at: Date): NewsConsent => ({
  consentGivenAt: row?.consentGivenAt ?? null,
  consentSource: row?.consentSource ?? null,
  consentTextVersion: row?.consentTextVersion ?? null,
  withdrawnAt: consentState(row) === 'given' ? at : (row?.withdrawnAt ?? null),
});

// What a save that switches news writes about consent, and the audit entry
// it makes; null when news is turned on without the current text version.
export function consentChange(
  enabled: boolean,
  before: NewsConsent | null,
  version: string | undefined,
  at: Date,
): { consent: NewsConsent; change: PreferenceChange | null } | null {
  const was = consentState(before);
  if (enabled && version !== NEWS_CONSENT_TEXT_VERSION) return null;
  const consent = enabled
    ? {
        consentGivenAt: at,
        consentSource: 'settings',
        consentTextVersion: NEWS_CONSENT_TEXT_VERSION,
        withdrawnAt: null,
      }
    : withdrawn(before, at);
  const now = consentState(consent);
  if (now === was) return { change: null, consent };
  return {
    change: {
      field: 'news_consent',
      newValue: enabled
        ? {
            state: now,
            textVersion: NEWS_CONSENT_TEXT_VERSION,
            via: 'settings',
          }
        : { state: now, via: 'settings' },
      oldValue: was,
    },
    consent,
  };
}
