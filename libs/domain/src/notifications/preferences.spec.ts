import { NOTIFICATION_TYPES, notificationType, sendsEmail } from './catalogue';
import {
  mutedChannels,
  type PreferenceRow,
  planSave,
  preferencesView,
} from './preferences';

const driverTypes = Object.keys(NOTIFICATION_TYPES).filter(
  (name) => NOTIFICATION_TYPES[name].group !== null,
);

const row = (
  type: string,
  channel: PreferenceRow['channel'],
  enabled: boolean,
  garageId: string | null = null,
): PreferenceRow => ({ channel, enabled, garageId, type });

const GARAGE = '0b7e4a52-9a5b-4c1a-8e3f-4a5b6d1f6a9c';

const groupTypes = (key: string) =>
  preferencesView([]).groups.find((g) => g.key === key)?.types ?? [];

describe('the driver groups', () => {
  it('are the five keys the panels show', () => {
    expect(preferencesView([]).groups.map((g) => g.key)).toEqual([
      'offers',
      'bookings',
      'due_dates',
      'news',
      'reviews_history',
    ]);
  });

  it('map each group to the catalogue types of that group', () => {
    expect(groupTypes('due_dates')).toEqual([
      'DUE_ITP',
      'DUE_RCA',
      'DUE_ROVINIETA',
      'SERVICE_DUE',
      'TYRES_SEASON',
    ]);
    expect(groupTypes('news')).toEqual(['NEWS']);
    expect(groupTypes('reviews_history')).toEqual([
      'CAR_TRANSFER_ACCEPTED',
      'REPAIR_UPDATED',
      'REVIEW_APPEAL_DECIDED',
      'REVIEW_DECIDED',
      'REVIEW_INVITE',
      'REVIEW_REPLIED',
    ]);
    const keys = preferencesView([]).groups.map((g) => g.key);
    expect(keys.flatMap(groupTypes).sort()).toEqual([...driverTypes].sort());
  });
});

describe('what a person reads when nothing is saved', () => {
  const view = preferencesView([]);

  it('has every group on except news', () => {
    expect(
      Object.fromEntries(view.groups.map((g) => [g.key, g.enabled])),
    ).toEqual({
      bookings: true,
      due_dates: true,
      news: false,
      offers: true,
      reviews_history: true,
    });
  });

  it('lists each group with the catalogue types of its group', () => {
    for (const group of view.groups) {
      expect(group.types).toEqual(
        driverTypes.filter((t) => NOTIFICATION_TYPES[t].group === group.key),
      );
    }
  });

  it('lists every driver type on e-mail, on except news, with no garage', () => {
    expect(view.preferences.map((p) => p.type).sort()).toEqual(
      [...driverTypes].sort(),
    );
    for (const p of view.preferences) {
      expect(p).toMatchObject({
        channel: 'email',
        enabled: p.type !== 'NEWS',
        garageId: null,
      });
    }
  });

  it('marks the types that are always sent', () => {
    const flag = (type: string) =>
      view.preferences.find((p) => p.type === type)?.alwaysSent;
    expect(flag('BOOKING_CONFIRMED')).toBe(true);
    expect(flag('JOB_READY')).toBe(true);
    expect(flag('BOOKING_REMINDER')).toBe(false);
  });
});

describe('what a person reads after saving', () => {
  it('shows a group off when every type of it that can be muted is off', () => {
    const view = preferencesView(
      groupTypes('due_dates').map((t) => row(t, 'email', false)),
    );
    expect(view.groups.find((g) => g.key === 'due_dates')?.enabled).toBe(false);
    expect(view.groups.find((g) => g.key === 'offers')?.enabled).toBe(true);
  });

  it('ignores always-sent types when it decides a group is off', () => {
    const mutable = groupTypes('bookings').filter(
      (t) => !notificationType(t).alwaysSent,
    );
    const view = preferencesView(mutable.map((t) => row(t, 'email', false)));
    expect(view.groups.find((g) => g.key === 'bookings')?.enabled).toBe(false);
  });

  it('shows a group on only when all its mutable types are on', () => {
    const view = preferencesView([row('DUE_ITP', 'email', false)]);
    expect(view.groups.find((g) => g.key === 'due_dates')?.enabled).toBe(false);
  });

  it('shows the channel a driver chose for a type', () => {
    const view = preferencesView([row('QUOTE_RECEIVED', 'whatsapp', true)]);
    expect(
      view.preferences.find((p) => p.type === 'QUOTE_RECEIVED'),
    ).toMatchObject({ channel: 'whatsapp', enabled: true });
  });

  it('lists saved staff rows after the driver types, apart from them', () => {
    const view = preferencesView([
      row('REQUEST_RECEIVED', 'push', false, GARAGE),
      row('QUOTE_RECEIVED', 'email', false),
    ]);
    expect(view.preferences.at(-1)).toEqual({
      alwaysSent: false,
      channel: 'push',
      enabled: false,
      garageId: GARAGE,
      type: 'REQUEST_RECEIVED',
    });
    expect(view.preferences.filter((p) => p.garageId !== null)).toHaveLength(1);
  });
});

describe('the channels muted for a message', () => {
  it('leaves only the default e-mail open for a driver type with no row', () => {
    expect(mutedChannels('DUE_ITP', [])).toEqual(
      new Set(['push', 'sms', 'whatsapp']),
    );
  });

  it('mutes every channel of a driver type that is off', () => {
    expect(mutedChannels('DUE_ITP', [row('DUE_ITP', 'email', false)])).toEqual(
      new Set(['email', 'push', 'sms', 'whatsapp']),
    );
  });

  it('opens only the chosen channel of a driver type', () => {
    expect(
      mutedChannels('QUOTE_RECEIVED', [
        row('QUOTE_RECEIVED', 'whatsapp', true),
      ]),
    ).toEqual(new Set(['email', 'push']));
  });

  it('keeps news muted while nothing is saved', () => {
    expect(mutedChannels('NEWS', [])).toEqual(new Set(['email']));
  });

  it('mutes only the staff channels switched off', () => {
    expect(
      mutedChannels('REQUEST_RECEIVED', [
        row('REQUEST_RECEIVED', 'push', false, GARAGE),
      ]),
    ).toEqual(new Set(['push']));
    expect(mutedChannels('REQUEST_RECEIVED', [])).toEqual(new Set());
  });

  it('never stops an always-sent message from going by e-mail', () => {
    const muted = mutedChannels('BOOKING_CONFIRMED', [
      row('BOOKING_CONFIRMED', 'whatsapp', true),
    ]);
    expect(sendsEmail(notificationType('BOOKING_CONFIRMED'), muted)).toBe(true);
  });

  it('stops a muted type from going by e-mail', () => {
    const muted = mutedChannels('DUE_ITP', [row('DUE_ITP', 'email', false)]);
    expect(sendsEmail(notificationType('DUE_ITP'), muted)).toBe(false);
  });
});

describe('what a save writes and records', () => {
  it('records a group switch that mutes the rest of a partly muted group', () => {
    const { changes, writes } = planSave(
      [row('DUE_ITP', 'email', false)],
      [{ enabled: false, key: 'due_dates' }],
      [],
    );
    expect(writes.map((w) => w.type)).toEqual([
      'DUE_RCA',
      'DUE_ROVINIETA',
      'SERVICE_DUE',
      'TYRES_SEASON',
    ]);
    expect(changes).toEqual([
      { field: 'group.due_dates', newValue: false, oldValue: false },
    ]);
  });

  it('writes and records nothing for a switch that changes nothing', () => {
    expect(planSave([], [{ enabled: true, key: 'offers' }], [])).toEqual({
      changes: [],
      writes: [],
    });
  });

  it('applies a choice after the group switches', () => {
    const { writes } = planSave(
      [],
      [{ enabled: false, key: 'offers' }],
      [row('QUOTE_RECEIVED', 'push', true)],
    );
    expect(writes.at(-1)).toEqual(row('QUOTE_RECEIVED', 'push', true));
  });
});
