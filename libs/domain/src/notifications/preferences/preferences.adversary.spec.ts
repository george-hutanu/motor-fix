import type { OutsideChannel } from '@motor-fix/contracts';

import {
  mutedChannels,
  type PreferenceRow,
  planSave,
  preferencesView,
} from './preferences';
import { NOTIFICATION_TYPES } from '../catalogue';

const row = (
  type: string,
  channel: OutsideChannel,
  enabled = true,
  garageId: string | null = null,
): PreferenceRow => ({ channel, enabled, garageId, type });

const driverRows = (pushDevice: boolean, rows: PreferenceRow[] = []) =>
  preferencesView(rows, pushDevice).preferences.filter(
    (p) => p.garageId === null,
  );

const GARAGE = '6f1c2f4e-8a0b-4c55-9d52-0d9f6b1f3a11';

// @traces 142-FR-005
describe('the default channel of a driver with nothing saved', () => {
  it('is push for every mutable type that offers push, and e-mail for the rest, when a device exists', () => {
    for (const p of driverRows(true)) {
      const type = NOTIFICATION_TYPES[p.type];
      const expected =
        !type.alwaysSent &&
        !type.transactional &&
        type.channels.includes('push')
          ? 'push'
          : 'email';
      expect([p.type, p.channel]).toEqual([p.type, expected]);
    }
  });

  it('is e-mail for every driver type when no device exists', () => {
    const channels = driverRows(false).map((p) => p.channel);
    expect(channels.length).toBeGreaterThan(10);
    expect(new Set(channels)).toEqual(new Set(['email']));
  });

  it('reads the pushDevice flag as false when it is left out', () => {
    expect(preferencesView([]).preferences.map((p) => p.channel)).toEqual(
      preferencesView([], false).preferences.map((p) => p.channel),
    );
  });

  it('keeps NEWS on e-mail and off, and JOB_READY on e-mail, with a device', () => {
    const view = driverRows(true);
    expect(view.find((p) => p.type === 'NEWS')).toMatchObject({
      channel: 'email',
      enabled: false,
    });
    expect(view.find((p) => p.type === 'JOB_READY')).toMatchObject({
      alwaysSent: true,
      channel: 'email',
      enabled: true,
    });
  });

  it('lets a saved e-mail row beat the push default', () => {
    const itp = driverRows(true, [row('DUE_ITP', 'email')]).find(
      (p) => p.type === 'DUE_ITP',
    );
    expect(itp?.channel).toBe('email');
  });

  it('shows a saved push row on push even with no device', () => {
    const itp = driverRows(false, [row('DUE_ITP', 'push')]).find(
      (p) => p.type === 'DUE_ITP',
    );
    expect(itp?.channel).toBe('push');
  });

  it('shows a saved SMS row even when the catalogue would not allow it for the type', () => {
    const quote = driverRows(true, [row('QUOTE_RECEIVED', 'sms')]).find(
      (p) => p.type === 'QUOTE_RECEIVED',
    );
    expect(quote?.channel).toBe('sms');
  });

  it('does not let a staff row of the same type change the driver default', () => {
    const view = driverRows(true, [
      row('QUOTE_RECEIVED', 'email', true, GARAGE),
    ]);
    expect(view.find((p) => p.type === 'QUOTE_RECEIVED')?.channel).toBe('push');
  });

  it('does not change which group switches read on', () => {
    expect(preferencesView([], true).groups).toEqual(
      preferencesView([], false).groups,
    );
  });
});

// @traces 142-FR-005
describe('the channels muted at send time', () => {
  it('mutes everything but push for a mutable type with a device and no row', () => {
    expect([...mutedChannels('DUE_ITP', [], null, true)].sort()).toEqual([
      'email',
      'sms',
      'whatsapp',
    ]);
  });

  it('mutes everything but e-mail for the same type with no device', () => {
    expect([...mutedChannels('DUE_ITP', [], null, false)].sort()).toEqual([
      'push',
      'sms',
      'whatsapp',
    ]);
  });

  it('agrees with the view for every driver type, with and without a device', () => {
    for (const pushDevice of [true, false]) {
      for (const p of driverRows(pushDevice)) {
        const muted = mutedChannels(p.type, [], null, pushDevice);
        const open = p.channels.filter((c) => !muted.has(c));
        expect([p.type, open]).toEqual([p.type, p.enabled ? [p.channel] : []]);
      }
    }
  });

  it('keeps JOB_READY on e-mail with a device', () => {
    expect([...mutedChannels('JOB_READY', [], null, true)].sort()).toEqual([
      'push',
      'whatsapp',
    ]);
  });

  it('mutes every channel of a type switched off, whatever the device', () => {
    const muted = mutedChannels(
      'DUE_ITP',
      [row('DUE_ITP', 'push', false)],
      null,
      true,
    );
    expect([...muted].sort()).toEqual(['email', 'push', 'sms', 'whatsapp']);
  });

  it('follows a saved SMS choice over the push default', () => {
    const muted = mutedChannels('DUE_ITP', [row('DUE_ITP', 'sms')], null, true);
    expect([...muted].sort()).toEqual(['email', 'push', 'whatsapp']);
  });

  it('ignores the device for a staff entry', () => {
    expect(mutedChannels('QUOTE_RECEIVED', [], GARAGE, true)).toEqual(
      mutedChannels('QUOTE_RECEIVED', [], GARAGE, false),
    );
  });

  it('throws for a type the catalogue does not know', () => {
    expect(() => mutedChannels('NOT_A_TYPE', [], null, true)).toThrow(
      'unknown notification type NOT_A_TYPE',
    );
  });
});

// @traces 142-FR-002 142-FR-008
describe('saving a channel', () => {
  it('records nothing when the pick is the default the read showed', () => {
    const plan = planSave([], [], [row('DUE_ITP', 'push')], true);
    expect(plan).toEqual({ changes: [], writes: [] });
  });

  it('records nothing for the e-mail default with no device', () => {
    expect(planSave([], [], [row('DUE_ITP', 'email')], false)).toEqual({
      changes: [],
      writes: [],
    });
  });

  it('records e-mail as a change when the default is push', () => {
    const plan = planSave([], [], [row('DUE_ITP', 'email')], true);
    expect(plan.changes).toEqual([
      {
        field: 'DUE_ITP',
        newValue: { channel: 'email', enabled: true },
        oldValue: { channel: 'push', enabled: true },
      },
    ]);
    expect(plan.writes).toEqual([row('DUE_ITP', 'email')]);
  });

  it('records old and new channel and enabled of a pick', () => {
    const plan = planSave(
      [row('DUE_ITP', 'sms')],
      [],
      [row('DUE_ITP', 'whatsapp')],
      false,
    );
    expect(plan.changes).toEqual([
      {
        field: 'DUE_ITP',
        newValue: { channel: 'whatsapp', enabled: true },
        oldValue: { channel: 'sms', enabled: true },
      },
    ]);
  });

  it('is idempotent: saving the written rows again changes nothing', () => {
    const first = planSave([], [], [row('DUE_RCA', 'sms')], true);
    const again = planSave(first.writes, [], [row('DUE_RCA', 'sms')], true);
    expect(again).toEqual({ changes: [], writes: [] });
  });

  it('records two changes when one save picks a type twice, the last winning', () => {
    const plan = planSave(
      [],
      [],
      [row('DUE_ITP', 'sms'), row('DUE_ITP', 'whatsapp')],
      false,
    );
    expect(plan.changes.map((c) => c.newValue)).toEqual([
      { channel: 'sms', enabled: true },
      { channel: 'whatsapp', enabled: true },
    ]);
    expect(plan.changes[1].oldValue).toEqual({ channel: 'sms', enabled: true });
  });

  it('records picking and picking back in one save as two entries', () => {
    const plan = planSave(
      [],
      [],
      [row('DUE_ITP', 'sms'), row('DUE_ITP', 'email')],
      false,
    );
    expect(plan.changes).toHaveLength(2);
  });

  it('does not count a save with empty groups and no choices', () => {
    expect(planSave([], [], [], true)).toEqual({ changes: [], writes: [] });
  });

  it('keeps the enabled it is sent, never switching a type on or off by itself', () => {
    const plan = planSave(
      [row('DUE_ITP', 'email', false)],
      [],
      [row('DUE_ITP', 'sms', false)],
      false,
    );
    expect(plan.writes).toEqual([row('DUE_ITP', 'sms', false)]);
  });

  it('leaves an unrelated type untouched when one is picked', () => {
    const plan = planSave(
      [row('DUE_RCA', 'sms')],
      [],
      [row('DUE_ITP', 'sms')],
      false,
    );
    expect(plan.writes.map((w) => w.type)).toEqual(['DUE_ITP']);
  });

  it('does not write the always-sent types when their group is switched off', () => {
    const plan = planSave([], [{ enabled: false, key: 'bookings' }], [], true);
    expect(plan.writes.map((w) => w.type)).not.toContain('JOB_READY');
    expect(plan.writes.every((w) => w.enabled === false)).toBe(true);
  });

  it('throws for a type the catalogue does not know', () => {
    expect(() => planSave([], [], [row('NOT_A_TYPE', 'email')], true)).toThrow(
      'unknown notification type NOT_A_TYPE',
    );
  });
});
