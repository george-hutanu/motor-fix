import { EventEmitter } from 'node:events';

import { Logger } from '@nestjs/common';

import type { LiveSubject } from './audience';
import { audienceOf } from './audience';
import type { GarageAccess } from './garage-access';
import { LiveHub } from './live.hub';
import type { Role } from '../auth/capabilities';

class Sink extends EventEmitter {
  chunks: string[] = [];
  ended = false;
  write(chunk: string) {
    this.chunks.push(chunk);
    return true;
  }
  end() {
    this.ended = true;
  }
  kinds() {
    return this.chunks
      .filter((c) => c.startsWith('event:'))
      .map((c) => (c.split('\n')[0] ?? '').replace(/^event: /, ''))
      .filter((k) => k !== 'hello');
  }
  byeReasons() {
    return this.chunks
      .filter((c) => c.startsWith('event: bye'))
      .map(
        (c) =>
          JSON.parse((c.split('\n')[1] ?? '').slice('data: '.length)).reason,
      );
  }
}

const NOW = Date.UTC(2026, 9, 5, 12, 0, 0);
const SECOND = 1_000;
const MINUTE = 60_000;
const NONE = {
  canAnswerQuotes: false,
  canMoveBookings: false,
  canRecordFinalPrice: false,
};

const access = (over: Partial<GarageAccess> = {}): GarageAccess => ({
  mechanics: new Map([
    ['elena', { ...NONE }],
    ['quoter', { ...NONE, canAnswerQuotes: true }],
    ['mover', { ...NONE, canMoveBookings: true }],
    ['both', { ...NONE, canAnswerQuotes: true, canMoveBookings: true }],
  ]),
  off: new Set(),
  owners: new Set(['ion']),
  receptionists: new Set(['maria']),
  ...over,
});

let publish: jest.Mock;
let load: jest.Mock<Promise<GarageAccess>, [string]>;
let hub: LiveHub;

beforeEach(() => {
  jest.useFakeTimers({ now: NOW });
  publish = jest.fn(async () => 1);
  load = jest.fn(async (_garageId: string) => access());
  hub = new LiveHub({ publish }, load);
});

afterEach(() => {
  hub.shutdown();
  jest.useRealTimers();
  jest.restoreAllMocks();
});

const open = (
  accountId: string,
  role: Role,
  channels: string[],
  garageId: string | null = null,
) => {
  const sink = new Sink();
  hub.open(sink, {
    accountId,
    channels,
    expiresAt: NOW + 60 * MINUTE,
    garageId,
    role,
  });
  return sink;
};

const staff = (
  accountId: string,
  role: Role,
  mechanicId?: string,
  garageId = 'g1',
) =>
  open(
    accountId,
    role,
    mechanicId
      ? [`account:${accountId}`, `garage:${garageId}`, `mechanic:${mechanicId}`]
      : [`account:${accountId}`, `garage:${garageId}`],
    garageId,
  );

const driver = (accountId: string) =>
  open(accountId, 'driver', [`account:${accountId}`]);

let counter = 0;
const fanOut = (audience: string[], kind: string, id = `e${++counter}`) =>
  hub.deliver(
    JSON.stringify({
      audience,
      event: { at: new Date(NOW).toISOString(), id, kind },
    }),
  );

const silenceLogs = () => [
  jest.spyOn(Logger.prototype, 'warn').mockImplementation(),
  jest.spyOn(Logger.prototype, 'error').mockImplementation(),
];

describe('audienceOf', () => {
  const sorted = (s: LiveSubject) => [...audienceOf(s)].sort();

  it('puts a request with no recipient garage only to the driver', () => {
    expect(
      audienceOf({ driverAccountId: 'd1', garageIds: [], type: 'request' }),
    ).toEqual(['account:d1']);
  });

  it('puts a request to the driver and every one of ten thousand recipient garages', () => {
    const garageIds = Array.from({ length: 10_000 }, (_, i) => `g${i}`);

    const audience = audienceOf({
      driverAccountId: 'd1',
      garageIds,
      type: 'request',
    });

    expect(new Set(audience)).toEqual(
      new Set(['account:d1', ...garageIds.map((g) => `garage:${g}`)]),
    );
  });

  it.each([
    'quote',
    'message',
  ] as const)('puts a %s to the driver and the one garage', (type) => {
    expect(sorted({ driverAccountId: 'd1', garageId: 'g1', type })).toEqual([
      'account:d1',
      'garage:g1',
    ]);
  });

  it.each([
    'booking',
    'job',
  ] as const)('puts a %s with a mechanic to the driver, garage and mechanic', (type) => {
    expect(
      sorted({
        driverAccountId: 'd1',
        garageId: 'g1',
        mechanicId: 'm1',
        type,
      }),
    ).toEqual(['account:d1', 'garage:g1', 'mechanic:m1']);
  });

  it.each([
    'booking',
    'job',
  ] as const)('puts a %s with no mechanic only to the driver and garage', (type) => {
    expect(
      sorted({
        driverAccountId: 'd1',
        garageId: 'g1',
        mechanicId: null,
        type,
      }),
    ).toEqual(['account:d1', 'garage:g1']);
  });

  it('puts a review to the garage, the author and both public feeds', () => {
    expect(
      sorted({ authorAccountId: 'a1', garageId: 'g1', type: 'review' }),
    ).toEqual(['account:a1', 'garage:g1', 'public:garage', 'public:mechanic']);
  });

  it('puts a car only to its owner', () => {
    expect(audienceOf({ ownerAccountId: 'o1', type: 'car' })).toEqual([
      'account:o1',
    ]);
  });

  it('puts a private repair only to its owner and a shared one also to the garage', () => {
    expect(
      sorted({ ownerAccountId: 'o1', sharedGarageId: null, type: 'repair' }),
    ).toEqual(['account:o1']);
    expect(
      sorted({ ownerAccountId: 'o1', sharedGarageId: 'g1', type: 'repair' }),
    ).toEqual(['account:o1', 'garage:g1']);
  });

  it('puts a verification to admin and the garage', () => {
    expect(sorted({ garageId: 'g1', type: 'verification' })).toEqual([
      'admin',
      'garage:g1',
    ]);
  });

  it('puts a platform rule to admin and system', () => {
    expect(sorted({ type: 'platform' })).toEqual(['admin', 'system']);
  });

  it('puts an account event only to that account', () => {
    expect(audienceOf({ accountId: 'a1', type: 'account' })).toEqual([
      'account:a1',
    ]);
  });

  it('never lets a private subject reach a public feed', () => {
    const subjects: LiveSubject[] = [
      { driverAccountId: 'd', garageIds: ['g'], type: 'request' },
      { driverAccountId: 'd', garageId: 'g', type: 'quote' },
      { driverAccountId: 'd', garageId: 'g', type: 'message' },
      { driverAccountId: 'd', garageId: 'g', mechanicId: 'm', type: 'booking' },
      { driverAccountId: 'd', garageId: 'g', mechanicId: 'm', type: 'job' },
      { ownerAccountId: 'o', type: 'car' },
      { ownerAccountId: 'o', sharedGarageId: 'g', type: 'repair' },
      { garageId: 'g', type: 'verification' },
      { type: 'platform' },
      { accountId: 'a', type: 'account' },
    ];

    for (const s of subjects)
      expect(audienceOf(s).filter((k) => k.startsWith('public:'))).toEqual([]);
  });

  it('does not change its answer between two calls', () => {
    const subject: LiveSubject = {
      driverAccountId: 'd1',
      garageIds: ['g1', 'g2'],
      type: 'request',
    };

    expect(audienceOf(subject)).toEqual(audienceOf(subject));
  });
});

describe('what each garage role gets through the garage channel', () => {
  it.each([
    'request.created',
    'message.created',
    'booking.moved',
    'price_list.updated',
    'garage.settings_changed',
    'garage.features_changed',
    'member.added',
    'mechanic.updated',
    'job.step_done',
    'live.test',
  ])('gives an owner %s', async (kind) => {
    const owner = staff('ion', 'garage');

    await fanOut(['garage:g1'], kind);

    expect(owner.kinds()).toEqual([kind]);
  });

  it.each([
    'price_list.updated',
    'price_list.item_added',
    'garage.settings_changed',
    'garage.features_changed',
    'member.added',
    'member.removed',
    'mechanic.created',
    'mechanic.updated',
  ])('keeps %s from a receptionist', async (kind) => {
    const receptionist = staff('maria', 'receptionist');

    await fanOut(['garage:g1'], kind);

    expect(receptionist.kinds()).toEqual([]);
  });

  it.each([
    'request.created',
    'quote.accepted',
    'booking.created',
    'message.created',
    'job.updated',
    'media.added',
    'garage.updated',
  ])('gives a receptionist %s', async (kind) => {
    const receptionist = staff('maria', 'receptionist');

    await fanOut(['garage:g1'], kind);

    expect(receptionist.kinds()).toEqual([kind]);
  });

  it.each([
    ['request.created', 'quoter'],
    ['request.updated', 'quoter'],
    ['message.created', 'quoter'],
    ['booking.moved', 'mover'],
    ['booking.move_requested', 'mover'],
  ])('gives a mechanic %s only with the matching right', async (kind, withRight) => {
    const allowed = staff(withRight, 'mechanic', 'mx');
    const denied = staff('elena', 'mechanic', 'm1');

    await fanOut(['garage:g1'], kind);

    expect(allowed.kinds()).toEqual([kind]);
    expect(denied.kinds()).toEqual([]);
  });

  it.each([
    'quote.created',
    'quote.accepted',
    'booking.created',
    'booking.cancelled',
    'job.updated',
    'media.added',
    'price_list.updated',
    'member.removed',
    'live.test',
    'requests.created',
    'request',
    'messages.created',
  ])('keeps %s from a mechanic holding every right', async (kind) => {
    const mechanic = staff('both', 'mechanic', 'm9');

    await fanOut(['garage:g1'], kind);

    expect(mechanic.kinds()).toEqual([]);
  });

  it('keeps request kinds from a mover and booking moves from a quoter', async () => {
    const mover = staff('mover', 'mechanic', 'm1');
    const quoter = staff('quoter', 'mechanic', 'm2');

    await fanOut(['garage:g1'], 'request.created');
    await fanOut(['garage:g1'], 'booking.moved');

    expect(mover.kinds()).toEqual(['booking.moved']);
    expect(quoter.kinds()).toEqual(['request.created']);
  });

  it('gives a mechanic a job addressed to their own channel without any right', async () => {
    const elena = staff('elena', 'mechanic', 'm1');

    await fanOut(['mechanic:m1'], 'job.updated');

    expect(elena.kinds()).toEqual(['job.updated']);
  });
});

describe('who still counts as staff', () => {
  it('gives nothing through the garage to a connection that claims a driver role', async () => {
    const sneaky = open('ion', 'driver', ['account:ion', 'garage:g1'], 'g1');

    await fanOut(['garage:g1'], 'request.created');

    expect(sneaky.kinds()).toEqual([]);
  });

  it('gives nothing to an owner connection whose account is only a receptionist', async () => {
    const sneaky = staff('maria', 'garage');

    await fanOut(['garage:g1'], 'request.created');

    expect(sneaky.kinds()).toEqual([]);
  });

  it('gives nothing to an account that is on no staff list of the garage', async () => {
    const stranger = staff('stranger', 'garage');

    await fanOut(['garage:g1'], 'request.created');

    expect(stranger.kinds()).toEqual([]);
  });

  it('gives nothing to a mechanic connection whose account has no mechanic record', async () => {
    const sneaky = staff('ion', 'mechanic', 'm1');

    await fanOut(['mechanic:m1', 'garage:g1'], 'job.updated');

    expect(sneaky.kinds()).toEqual([]);
  });

  it('stops giving a removed owner events once the cached list expires', async () => {
    const owner = staff('ion', 'garage');
    await fanOut(['garage:g1'], 'request.created');
    load.mockResolvedValue(access({ owners: new Set() }));

    jest.advanceTimersByTime(MINUTE);
    await fanOut(['garage:g1'], 'request.created');

    expect(owner.kinds()).toEqual(['request.created']);
  });

  it('checks the garage of the connection, not any garage it listens to', async () => {
    load.mockImplementation(async (g) =>
      access({ owners: new Set(g === 'g1' ? ['ion'] : []) }),
    );
    const owner = staff('ion', 'garage', undefined, 'g2');

    await fanOut(['garage:g2'], 'request.created');

    expect(owner.kinds()).toEqual([]);
  });
});

describe('garage feature switches', () => {
  it.each([
    'media.added',
    'media.removed',
    'media.anything',
  ])('keeps %s from every staff role when live_media is off', async (kind) => {
    load.mockResolvedValue(access({ off: new Set(['live_media']) }));
    const owner = staff('ion', 'garage');
    const receptionist = staff('maria', 'receptionist');
    const mechanic = staff('elena', 'mechanic', 'm1');

    await fanOut(['garage:g1', 'mechanic:m1'], kind);

    expect(owner.kinds()).toEqual([]);
    expect(receptionist.kinds()).toEqual([]);
    expect(mechanic.kinds()).toEqual([]);
  });

  it('still gives the driver a media event when the garage switched live_media off', async () => {
    load.mockResolvedValue(access({ off: new Set(['live_media']) }));
    const d1 = driver('d1');
    const owner = staff('ion', 'garage');

    await fanOut(['account:d1', 'garage:g1'], 'media.added');

    expect(d1.kinds()).toEqual(['media.added']);
    expect(owner.kinds()).toEqual([]);
  });

  it('still gives staff other kinds when live_media is off', async () => {
    load.mockResolvedValue(access({ off: new Set(['live_media']) }));
    const owner = staff('ion', 'garage');

    await fanOut(['garage:g1'], 'job.updated');

    expect(owner.kinds()).toEqual(['job.updated']);
  });

  it('still gives staff media when only some other feature is off', async () => {
    load.mockResolvedValue(access({ off: new Set(['something_else']) }));
    const owner = staff('ion', 'garage');

    await fanOut(['garage:g1'], 'media.added');

    expect(owner.kinds()).toEqual(['media.added']);
  });

  it('gives media to staff of a garage with no switches at all', async () => {
    const owner = staff('ion', 'garage');

    await fanOut(['garage:g1'], 'media.added');

    expect(owner.kinds()).toEqual(['media.added']);
  });

  it('applies the switch per garage', async () => {
    load.mockImplementation(async (g) =>
      access({ off: new Set(g === 'g1' ? ['live_media'] : []) }),
    );
    const one = staff('ion', 'garage', undefined, 'g1');
    const two = staff('ion', 'garage', undefined, 'g2');

    await fanOut(['garage:g1', 'garage:g2'], 'media.added');

    expect(one.kinds()).toEqual([]);
    expect(two.kinds()).toEqual(['media.added']);
  });
});

describe('the staff cache', () => {
  it('reads a garage once for many events inside sixty seconds', async () => {
    staff('ion', 'garage');

    await fanOut(['garage:g1'], 'request.created');
    await fanOut(['garage:g1'], 'request.created');
    jest.advanceTimersByTime(60 * SECOND - 1);
    await fanOut(['garage:g1'], 'request.created');

    expect(load).toHaveBeenCalledTimes(1);
  });

  it('reads the garage again at sixty seconds', async () => {
    staff('ion', 'garage');
    await fanOut(['garage:g1'], 'request.created');

    jest.advanceTimersByTime(60 * SECOND);
    await fanOut(['garage:g1'], 'request.created');

    expect(load).toHaveBeenCalledTimes(2);
  });

  it('reads two garages separately', async () => {
    staff('ion', 'garage', undefined, 'g1');
    staff('ion', 'garage', undefined, 'g2');

    await fanOut(['garage:g1', 'garage:g2'], 'request.created');

    expect(load.mock.calls.map(([g]) => g).sort()).toEqual(['g1', 'g2']);
  });

  it('reads a garage once when several events arrive together', async () => {
    staff('ion', 'garage');

    await Promise.all([
      fanOut(['garage:g1'], 'request.created'),
      fanOut(['garage:g1'], 'request.created'),
      fanOut(['garage:g1'], 'request.created'),
    ]);

    expect(load).toHaveBeenCalledTimes(1);
  });

  it.each([
    'member.removed',
    'mechanic.updated',
    'garage.features_changed',
  ])('reads the garage again right after %s passes through', async (kind) => {
    staff('ion', 'garage');
    await fanOut(['garage:g1'], 'request.created');
    load.mockClear();

    await fanOut(['garage:g1'], kind, 'ghost');
    await fanOut(['garage:g1'], 'request.created');

    expect(load).toHaveBeenCalledTimes(1);
  });

  it('turns a feature off for staff as soon as the features change event passes', async () => {
    const owner = staff('ion', 'garage');
    await fanOut(['garage:g1'], 'media.added');
    load.mockResolvedValue(access({ off: new Set(['live_media']) }));

    await fanOut(['garage:g1'], 'garage.features_changed');
    await fanOut(['garage:g1'], 'media.added');

    expect(owner.kinds()).toEqual(['media.added', 'garage.features_changed']);
  });

  it('applies new mechanic rights as soon as the mechanic updated event passes', async () => {
    const elena = staff('elena', 'mechanic', 'm1');
    await fanOut(['garage:g1'], 'request.created');
    load.mockResolvedValue(
      access({
        mechanics: new Map([['elena', { ...NONE, canAnswerQuotes: true }]]),
      }),
    );

    await fanOut(['garage:g1'], 'mechanic.updated');
    await fanOut(['garage:g1'], 'request.created');

    expect(elena.kinds()).toEqual(['request.created']);
  });

  it('keeps another garage cached when one garage is invalidated', async () => {
    staff('ion', 'garage', undefined, 'g1');
    staff('ion', 'garage', undefined, 'g2');
    await fanOut(['garage:g1', 'garage:g2'], 'request.created');
    load.mockClear();

    await fanOut(['garage:g1'], 'garage.features_changed');
    await fanOut(['garage:g2'], 'request.created');

    expect(load.mock.calls.map(([g]) => g)).not.toContain('g2');
  });
});

describe('a removed member', () => {
  it('leaves the garage and mechanic channels at once, keeping the account channel', async () => {
    const elena = staff('elena', 'mechanic', 'm1');
    const elenaDriverTab = driver('elena');

    await fanOut(['garage:g1'], 'member.removed', 'elena');
    await fanOut(['garage:g1', 'mechanic:m1', 'account:elena'], 'job.updated');

    expect(elena.kinds()).toEqual(['job.updated']);
    expect(elenaDriverTab.kinds()).toEqual(['job.updated']);
    expect(elena.ended).toBe(false);
  });

  it('stops events through the garage channel even before the cache would expire', async () => {
    const owner = staff('ion', 'garage');
    await fanOut(['garage:g1'], 'request.created');

    await fanOut(['garage:g1'], 'member.removed', 'ion');
    await fanOut(['garage:g1'], 'request.created');

    expect(owner.kinds().filter((k) => k === 'request.created')).toHaveLength(
      1,
    );
  });

  it('leaves the channels of every open connection of that account', async () => {
    const tabs = [staff('ion', 'garage'), staff('ion', 'garage')];

    await fanOut(['garage:g1'], 'member.removed', 'ion');
    await fanOut(['garage:g1'], 'request.created');

    for (const tab of tabs)
      expect(tab.kinds()).not.toContain('request.created');
  });

  it('does not touch a colleague of the same garage', async () => {
    const owner = staff('ion', 'garage');
    const receptionist = staff('maria', 'receptionist');

    await fanOut(['garage:g1'], 'member.removed', 'maria');
    await fanOut(['garage:g1'], 'request.created');

    expect(owner.kinds()).toContain('request.created');
    expect(receptionist.kinds()).toEqual([]);
  });

  it('does not remove the person from a different garage', async () => {
    const other = staff('ion', 'garage', undefined, 'g2');

    await fanOut(['garage:g1'], 'member.removed', 'ion');
    await fanOut(['garage:g2'], 'request.created');

    expect(other.kinds()).toEqual(['request.created']);
  });

  it('removes nobody when the audience holds no garage key', async () => {
    const owner = staff('ion', 'garage');

    await fanOut(['account:ion'], 'member.removed', 'ion');
    await fanOut(['garage:g1'], 'request.created');

    expect(owner.kinds()).toEqual(['member.removed', 'request.created']);
  });

  it('ignores a removed id that names nobody', async () => {
    const owner = staff('ion', 'garage');

    await expect(
      fanOut(['garage:g1'], 'member.removed', 'ghost'),
    ).resolves.toBeUndefined();
    await fanOut(['garage:g1'], 'request.created');

    expect(owner.kinds()).toContain('request.created');
  });
});

describe('suspended and deleted accounts', () => {
  it.each([
    'account.suspended',
    'account.deleted',
  ])('sends bye evicted to every stream of the account on %s and ends them', async (kind) => {
    const tabs = [driver('a1'), staff('a1', 'garage'), driver('a1')];
    const bystander = driver('b2');

    await fanOut(['account:a1'], kind, 'a1');

    for (const tab of tabs) {
      expect(tab.byeReasons()).toEqual(['evicted']);
      expect(tab.ended).toBe(true);
    }
    expect(bystander.byeReasons()).toEqual([]);
    expect(bystander.ended).toBe(false);
  });

  it('evicts the account named by the id even when the audience names another', async () => {
    const victim = driver('a1');
    const reader = driver('admin1');

    await fanOut(['account:admin1'], 'account.suspended', 'a1');

    expect(victim.byeReasons()).toEqual(['evicted']);
    expect(reader.ended).toBe(false);
  });

  it('writes nothing more to an evicted stream', async () => {
    const tab = driver('a1');

    await fanOut(['account:a1'], 'account.deleted', 'a1');
    const written = tab.chunks.length;
    await fanOut(['account:a1'], 'job.updated');

    expect(tab.chunks).toHaveLength(written);
  });

  it('keeps streams open for other account kinds', async () => {
    const tab = driver('a1');

    await fanOut(['account:a1'], 'account.updated', 'a1');

    expect(tab.ended).toBe(false);
    expect(tab.kinds()).toEqual(['account.updated']);
  });

  it('sends one bye even when the event passes through twice', async () => {
    const tab = driver('a1');

    await fanOut(['account:a1'], 'account.suspended', 'a1');
    await fanOut(['account:a1'], 'account.suspended', 'a1');

    expect(tab.byeReasons()).toEqual(['evicted']);
  });

  it('copes with an unknown account id', async () => {
    const tab = driver('a1');

    await expect(
      fanOut(['account:zz'], 'account.suspended', 'zz'),
    ).resolves.toBeUndefined();

    expect(tab.ended).toBe(false);
  });
});

describe('public connections', () => {
  it.each([
    'request.created',
    'quote.created',
    'booking.created',
    'job.step_done',
    'media.added',
    'live.test',
    'message.created',
    'car.updated',
    'repair.shared',
  ])('never gets %s through a public key', async (kind) => {
    const pub = open('anon', 'driver', ['public:garage', 'public:mechanic']);

    await fanOut(['public:garage', 'public:mechanic'], kind);

    expect(pub.kinds()).toEqual([]);
  });

  it('gets a review event through a public key', async () => {
    const pub = open('anon', 'driver', ['public:garage']);

    await fanOut(['public:garage'], 'review.created');

    expect(pub.kinds()).toEqual(['review.created']);
  });

  it('still gives a private kind through the account channel, once, when public is listed first', async () => {
    const tab = open('d1', 'driver', ['account:d1', 'public:garage']);

    await fanOut(['public:garage', 'account:d1'], 'request.created');

    expect(tab.kinds()).toEqual(['request.created']);
  });
});

describe('one delivery per connection', () => {
  it('gives a staff connection one event when several of its channels are in the audience', async () => {
    const mechanic = staff('quoter', 'mechanic', 'm1');

    await fanOut(
      ['account:quoter', 'garage:g1', 'mechanic:m1', 'garage:g1'],
      'request.created',
    );

    expect(mechanic.kinds()).toEqual(['request.created']);
  });

  it('delivers through a later key when an earlier key does not allow it', async () => {
    const mechanic = staff('elena', 'mechanic', 'm1');

    await fanOut(['garage:g1', 'mechanic:m1'], 'job.updated');

    expect(mechanic.kinds()).toEqual(['job.updated']);
  });

  it('gives two connections of one account one event each', async () => {
    const tabs = [driver('d1'), driver('d1')];

    await fanOut(['account:d1', 'account:d1'], 'job.updated');

    for (const tab of tabs) expect(tab.kinds()).toEqual(['job.updated']);
  });
});

describe('when reading a garage fails', () => {
  it('drops the event for that garage staff, logs it, and still serves everyone else', async () => {
    const spies = silenceLogs();
    load.mockRejectedValue(new Error('db down'));
    const owner = staff('ion', 'garage');
    const mechanic = staff('quoter', 'mechanic', 'm1');
    const d1 = driver('d1');

    await expect(
      fanOut(['account:d1', 'garage:g1', 'mechanic:m1'], 'request.created'),
    ).resolves.toBeUndefined();

    expect(owner.kinds()).toEqual([]);
    expect(mechanic.kinds()).toEqual([]);
    expect(d1.kinds()).toEqual(['request.created']);
    expect(spies.reduce((n, s) => n + s.mock.calls.length, 0)).toBeGreaterThan(
      0,
    );
  });

  it('survives a loader that throws synchronously', async () => {
    silenceLogs();
    load.mockImplementation(() => {
      throw new Error('sync boom');
    });
    const owner = staff('ion', 'garage');
    const d1 = driver('d1');

    await expect(
      fanOut(['account:d1', 'garage:g1'], 'request.created'),
    ).resolves.toBeUndefined();

    expect(owner.kinds()).toEqual([]);
    expect(d1.kinds()).toEqual(['request.created']);
  });

  it('survives a loader that rejects with a non-Error', async () => {
    silenceLogs();
    load.mockRejectedValue('down');
    const d1 = driver('d1');
    staff('ion', 'garage');

    await expect(
      fanOut(['account:d1', 'garage:g1'], 'request.created'),
    ).resolves.toBeUndefined();

    expect(d1.kinds()).toEqual(['request.created']);
  });

  it('reads again on the next event and delivers once the read works', async () => {
    silenceLogs();
    load.mockRejectedValueOnce(new Error('db down'));
    const owner = staff('ion', 'garage');

    await fanOut(['garage:g1'], 'request.created');
    await fanOut(['garage:g1'], 'request.created');

    expect(load).toHaveBeenCalledTimes(2);
    expect(owner.kinds()).toEqual(['request.created']);
  });

  it('does not affect the staff of a garage whose read worked', async () => {
    silenceLogs();
    load.mockImplementation(async (g) => {
      if (g === 'g1') throw new Error('db down');
      return access();
    });
    const broken = staff('ion', 'garage', undefined, 'g1');
    const healthy = staff('ion', 'garage', undefined, 'g2');

    await fanOut(['garage:g1', 'garage:g2'], 'request.created');

    expect(broken.kinds()).toEqual([]);
    expect(healthy.kinds()).toEqual(['request.created']);
  });

  it('still gives a staff connection an event addressed to its own account channel', async () => {
    silenceLogs();
    load.mockRejectedValue(new Error('db down'));
    const owner = staff('ion', 'garage');

    await fanOut(['account:ion', 'garage:g1'], 'account.updated', 'ion');

    expect(owner.kinds()).toEqual(['account.updated']);
  });
});
