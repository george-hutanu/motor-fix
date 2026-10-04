import {
  type DriverGroup,
  NOTIFICATION_TYPES,
  notificationType,
  type OutsideChannel,
} from './catalogue';

export const DRIVER_GROUPS: readonly DriverGroup[] = [
  'offers',
  'bookings',
  'due_dates',
  'news',
  'reviews_history',
];

export interface PreferenceRow {
  type: string;
  channel: OutsideChannel;
  enabled: boolean;
  garageId: string | null;
}

const NAMES = Object.keys(NOTIFICATION_TYPES);

export const groupTypes = (group: DriverGroup) =>
  NAMES.filter((name) => NOTIFICATION_TYPES[name].group === group);

// A driver type has one row, its chosen channel; any other type has one row
// per channel.
export const isDriverType = (name: string) =>
  notificationType(name).group !== null;

export const canMute = (name: string) => {
  const type = notificationType(name);
  return !type.alwaysSent && !type.transactional;
};

const enabledByDefault = (name: string) => name !== 'NEWS';

// What a driver type is when nothing is saved: every driver type allows e-mail.
export function driverChoice(
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
  const groups = DRIVER_GROUPS.map((key) => ({
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
    .filter((r) => !isDriverType(r.type))
    .map((r) => ({
      alwaysSent: !canMute(r.type),
      channel: r.channel,
      enabled: r.enabled,
      garageId: r.garageId,
      type: r.type,
    }));
  return { groups, preferences: [...driver, ...staff] };
}

// The outside channels a message of this type must not go by, from the
// person's rows for it (already narrowed to the message's garage).
export function mutedChannels(
  name: string,
  rows: readonly PreferenceRow[],
): Set<OutsideChannel> {
  const { channels } = notificationType(name);
  if (isDriverType(name)) {
    const { channel, enabled } = driverChoice(name, rows);
    return new Set(channels.filter((c) => !enabled || c !== channel));
  }
  return new Set(
    channels.filter(
      (c) =>
        rows.find((r) => r.type === name && r.channel === c)?.enabled === false,
    ),
  );
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
  (isDriverType(a.type) || a.channel === b.channel);

function put(plan: Plan, next: PreferenceRow) {
  plan.rows = [...plan.rows.filter((r) => !sameRow(r, next)), next];
  plan.writes.push(next);
}

// Always-sent types of the group are left as they are.
function switchGroup(plan: Plan, key: DriverGroup, enabled: boolean) {
  const before = groupOn(key, plan.rows);
  for (const type of groupTypes(key).filter(canMute)) {
    const was = driverChoice(type, plan.rows);
    if (was.enabled !== enabled) {
      put(plan, { channel: was.channel, enabled, garageId: null, type });
    }
  }
  if (before === enabled) return;
  plan.changes.push({
    field: `group.${key}`,
    newValue: enabled,
    oldValue: before,
  });
}

function choose(plan: Plan, choice: PreferenceRow) {
  const { channel, enabled, garageId, type } = choice;
  if (isDriverType(type)) {
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
  const was = plan.rows.find((r) => sameRow(r, choice))?.enabled ?? true;
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
