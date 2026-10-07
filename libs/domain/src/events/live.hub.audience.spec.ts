import { EventEmitter } from 'node:events';

import { EVENT_KINDS } from '@motor-fix/contracts';
import { Logger } from '@nestjs/common';

import type { GarageAccess } from './garage-access';
import { KIND_CAPABILITY, LiveHub } from './live.hub';
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
  byes() {
    return this.chunks
      .filter((c) => c.startsWith('event: bye'))
      .map((c) => JSON.parse((c.split('\n')[1] ?? '').slice('data: '.length)));
  }
}

const NOW = Date.UTC(2026, 9, 5, 12, 0, 0);
const MINUTE = 60_000;
const NONE = {
  canAnswerQuotes: false,
  canMoveBookings: false,
  canRecordFinalPrice: false,
};

const access = (over: Partial<GarageAccess> = {}): GarageAccess => ({
  mechanics: new Map([
    ['elena', { ...NONE }],
    ['mihai', { ...NONE }],
    ['quoter', { ...NONE, canAnswerQuotes: true }],
    ['mover', { ...NONE, canMoveBookings: true }],
  ]),
  off: new Set(),
  owners: new Set(['ion']),
  receptionists: new Set(['maria']),
  ...over,
});

let load: jest.Mock<Promise<GarageAccess>, [string]>;
let hub: LiveHub;

beforeEach(() => {
  jest.useFakeTimers({ now: NOW });
  load = jest.fn(async (_garageId: string) => access());
  hub = new LiveHub(load);
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
    channels: [`account:${accountId}`, 'system', ...channels],
    expiresAt: NOW + 15 * MINUTE,
    garageId,
    role,
  });
  return sink;
};

const staff = (accountId: string, role: Role, mechanicId?: string) =>
  open(
    accountId,
    role,
    mechanicId ? ['garage:g1', `mechanic:${mechanicId}`] : ['garage:g1'],
    'g1',
  );

const fanOut = (audience: string[], kind: string, id = 'e1') =>
  hub.deliver(
    JSON.stringify({
      audience,
      event: { at: new Date(NOW).toISOString(), id, kind },
    }),
  );

describe('who a live event reaches', () => {
  it("gives a driver's job step to that driver and the garage owner, never to another driver", async () => {
    const andrei = open('andrei', 'driver', []);
    const maria = open('maria-driver', 'driver', []);
    const owner = staff('ion', 'garage');

    await fanOut(
      ['account:andrei', 'garage:g1', 'mechanic:m2'],
      'job.step_done',
    );

    expect(andrei.kinds()).toEqual(['job.step_done']);
    expect(owner.kinds()).toEqual(['job.step_done']);
    expect(maria.kinds()).toEqual([]);
  });

  it('drops and logs an event with no audience', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const sinks = [open('andrei', 'driver', []), staff('ion', 'garage')];

    await fanOut([], 'live.test');

    for (const sink of sinks) expect(sink.kinds()).toEqual([]);
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/no audience/));
  });

  it("gives a mechanic only their own jobs' events, not a colleague's", async () => {
    const elena = staff('elena', 'mechanic', 'm1');
    const mihai = staff('mihai', 'mechanic', 'm2');

    await fanOut(['account:d1', 'garage:g1', 'mechanic:m2'], 'job.updated');

    expect(mihai.kinds()).toEqual(['job.updated']);
    expect(elena.kinds()).toEqual([]);
  });

  it('gives a mechanic a new request only with the right to answer quotes', async () => {
    const without = staff('elena', 'mechanic', 'm1');
    const withRight = staff('quoter', 'mechanic', 'm3');

    await fanOut(['account:d1', 'garage:g1'], 'request.created');
    await fanOut(['account:d1', 'garage:g1'], 'message.sent');
    await fanOut(['account:d1', 'garage:g1'], 'quote.sent');

    expect(without.kinds()).toEqual([]);
    expect(withRight.kinds()).toEqual(['request.created', 'message.sent']);
  });

  it('gives a mechanic booking moves only with the right to move bookings', async () => {
    const without = staff('elena', 'mechanic', 'm1');
    const mover = staff('mover', 'mechanic', 'm4');

    await fanOut(['account:d1', 'garage:g1'], 'booking.move_refused');
    await fanOut(['account:d1', 'garage:g1'], 'booking.created');

    expect(without.kinds()).toEqual([]);
    expect(mover.kinds()).toEqual(['booking.move_refused']);
  });

  it('keeps prices, settings, feature switches, the team, reviews, the profile and invites from a receptionist, and gives the owner everything', async () => {
    const receptionist = staff('maria', 'receptionist');
    const owner = staff('ion', 'garage');
    const hidden = [
      'price_list.updated',
      'garage.settings_changed',
      'garage.features_changed',
      'member.joined',
      'mechanic.updated',
      'review.posted',
      'garage.updated',
      'invite.sent',
    ];
    const shown = [
      'request.created',
      'message.sent',
      'booking.move_proposed',
      'quote.sent',
      'booking.confirmed',
    ];

    for (const kind of [...hidden, ...shown]) {
      await fanOut(['garage:g1'], kind);
    }

    expect(receptionist.kinds()).toEqual(shown);
    expect(owner.kinds()).toEqual([...hidden, ...shown]);
  });

  it("forwards no media event to the staff of a garage that switched live media off, and still to the job's driver", async () => {
    load.mockResolvedValue(access({ off: new Set(['live_media']) }));
    const owner = staff('ion', 'garage');
    const mechanic = staff('mihai', 'mechanic', 'm2');
    const driver = open('d1', 'driver', []);

    await fanOut(['account:d1', 'garage:g1', 'mechanic:m2'], 'media.added');
    await fanOut(['account:d1', 'garage:g1', 'mechanic:m2'], 'job.updated');

    expect(owner.kinds()).toEqual(['job.updated']);
    expect(mechanic.kinds()).toEqual(['job.updated']);
    expect(driver.kinds()).toEqual(['media.added', 'job.updated']);
  });

  it('forwards nothing through the garage to an account that is no longer its staff in that role', async () => {
    const formerOwner = staff('gone', 'garage');
    const formerMechanic = staff('gone-too', 'mechanic', 'm9');

    await fanOut(['garage:g1', 'mechanic:m9'], 'job.updated');

    expect(formerOwner.kinds()).toEqual([]);
    expect(formerMechanic.kinds()).toEqual([]);
  });

  it('never forwards a private kind through a public key', async () => {
    const page = open('visitor', 'driver', ['public:garage']);

    for (const kind of [
      'request.created',
      'quote.sent',
      'booking.created',
      'job.updated',
      'media.added',
      'live.started',
      'message.sent',
      'car.updated',
      'repair.logged',
    ]) {
      await fanOut(['public:garage'], kind);
    }
    await fanOut(['public:garage'], 'review.published');

    expect(page.kinds()).toEqual(['review.published']);
  });
});

describe('the cached garage access', () => {
  it('reads a garage once and keeps it for 60 seconds', async () => {
    staff('ion', 'garage');
    staff('maria', 'receptionist');

    await fanOut(['garage:g1'], 'request.created');
    await fanOut(['garage:g1'], 'request.updated');
    expect(load).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(60_001);
    await fanOut(['garage:g1'], 'request.updated');
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('stops forwarding to a removed member within 60 seconds without any event', async () => {
    const receptionist = staff('maria', 'receptionist');
    await fanOut(['garage:g1'], 'request.created');

    load.mockResolvedValue(access({ receptionists: new Set() }));
    jest.advanceTimersByTime(60_001);
    await fanOut(['garage:g1'], 'request.updated');

    expect(receptionist.kinds()).toEqual(['request.created']);
  });

  it.each(['member.removed', 'mechanic.updated', 'garage.features_changed'])(
    'reads the garage again at once after %s',
    async (kind) => {
      const mechanic = staff('elena', 'mechanic', 'm1');
      await fanOut(['garage:g1'], 'request.created');
      expect(mechanic.kinds()).toEqual([]);

      load.mockResolvedValue(
        access({
          mechanics: new Map([['elena', { ...NONE, canAnswerQuotes: true }]]),
        }),
      );
      await fanOut(['garage:g1'], kind, 'someone-else');
      await fanOut(['garage:g1'], 'request.updated');

      expect(load).toHaveBeenCalledTimes(2);
      expect(mechanic.kinds()).toEqual(['request.updated']);
    },
  );

  it("drops the event for that garage's staff only and logs it when the garage cannot be read", async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    load.mockRejectedValueOnce(new Error('database down'));
    const owner = staff('ion', 'garage');
    const driver = open('d1', 'driver', []);

    await fanOut(['account:d1', 'garage:g1'], 'request.created');
    await fanOut(['account:d1', 'garage:g1'], 'request.updated');

    expect(driver.kinds()).toEqual(['request.created', 'request.updated']);
    expect(owner.kinds()).toEqual(['request.updated']);
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/database down/));
  });
});

describe('streams that follow the account', () => {
  it("takes a removed member's streams off the garage and their mechanic channel at once", async () => {
    const removed = staff('mihai', 'mechanic', 'm2');
    const colleague = staff('ion', 'garage');

    await fanOut(['garage:g1'], 'member.removed', 'mihai');
    await fanOut(['account:d1', 'garage:g1', 'mechanic:m2'], 'job.updated');

    expect(removed.kinds()).toEqual([]);
    expect(colleague.kinds()).toEqual(['member.removed', 'job.updated']);
  });

  it('leaves the streams of the same account at another garage alone', async () => {
    load.mockImplementation(async (garageId) =>
      garageId === 'g2' ? access({ owners: new Set(['mihai']) }) : access(),
    );
    const elsewhere = open('mihai', 'garage', ['garage:g2'], 'g2');

    await fanOut(['garage:g1'], 'member.removed', 'mihai');
    await fanOut(['garage:g2'], 'request.created');

    expect(elsewhere.kinds()).toEqual(['request.created']);
  });

  it.each(['account.suspended', 'account.deleted'])(
    'ends every stream of the account with bye evicted on %s',
    async (kind) => {
      const phone = open('andrei', 'driver', []);
      const laptop = open('andrei', 'driver', []);
      const other = open('elena', 'driver', []);

      await fanOut(['account:andrei'], kind, 'andrei');

      for (const sink of [phone, laptop]) {
        expect(sink.byes()).toEqual([
          expect.objectContaining({ reason: 'evicted' }),
        ]);
        expect(sink.ended).toBe(true);
      }
      expect(other.ended).toBe(false);
    },
  );
});

describe('what each garage role hears through the garage channel', () => {
  // One kind per family of the capability table, and one no family claims.
  const FAMILIES = [
    ['price_list.updated', 'garage.prices'],
    ['member.removed', 'garage.team'],
    ['mechanic.added', 'garage.team'],
    ['invite.sent', 'garage.team'],
    ['garage.features_changed', 'garage.feature_switches'],
    ['garage.updated', 'garage.profile'],
    ['review.posted', 'garage.reviews'],
    ['request.created', 'garage.requests'],
    ['message.sent', 'garage.requests'],
    ['booking.move_proposed', 'garage.schedule'],
    ['booking.moved', 'garage.schedule'],
    ['quote.sent', null],
  ] as const;

  // Who hears each family: the owner, a receptionist, a mechanic with no
  // rights, one who may answer quotes, and one who may move bookings.
  const HEARS: Record<string, [boolean, boolean, boolean, boolean, boolean]> = {
    'garage.feature_switches': [true, false, false, false, false],
    'garage.prices': [true, false, false, false, false],
    'garage.profile': [true, false, false, false, false],
    'garage.requests': [true, true, false, true, false],
    'garage.reviews': [true, false, false, false, false],
    'garage.schedule': [true, true, false, false, true],
    'garage.team': [true, false, false, false, false],
    none: [true, true, false, false, false],
  };

  it.each(FAMILIES)(
    "delivers %s by the role's %s capability",
    async (kind, capability) => {
      const streams = [
        staff('ion', 'garage'),
        staff('maria', 'receptionist'),
        staff('elena', 'mechanic', 'm1'),
        staff('quoter', 'mechanic', 'm3'),
        staff('mover', 'mechanic', 'm4'),
      ];

      await fanOut(['garage:g1'], kind);

      expect(streams.map((s) => s.kinds().length === 1)).toEqual(
        HEARS[capability ?? 'none'],
      );
    },
  );

  it('gives a mechanic with every right nothing beyond requests, messages and booking moves', async () => {
    load.mockResolvedValue(
      access({
        mechanics: new Map([
          [
            'all',
            {
              canAnswerQuotes: true,
              canMoveBookings: true,
              canRecordFinalPrice: true,
            },
          ],
        ]),
      }),
    );
    const mechanic = staff('all', 'mechanic', 'm5');

    for (const kind of [
      'quote.sent',
      'booking.confirmed',
      'review.posted',
      'price_list.updated',
      'job.started',
      'request.created',
      'booking.moved',
    ]) {
      await fanOut(['garage:g1'], kind);
    }

    expect(mechanic.kinds()).toEqual(['request.created', 'booking.moved']);
  });

  it('checks a receptionist is still staff before the capability table', async () => {
    load.mockResolvedValue(access({ receptionists: new Set() }));
    const former = staff('maria', 'receptionist');

    await fanOut(['garage:g1'], 'request.created');
    await fanOut(['garage:g1'], 'quote.sent');

    expect(former.kinds()).toEqual([]);
  });

  it("keeps a mechanic's own jobs and bookings on their mechanic channel whatever the rights", async () => {
    const mechanic = staff('elena', 'mechanic', 'm1');

    await fanOut(['garage:g1', 'mechanic:m1'], 'job.started');
    await fanOut(['garage:g1', 'mechanic:m1'], 'booking.confirmed');

    expect(mechanic.kinds()).toEqual(['job.started', 'booking.confirmed']);
  });
});

describe('the kind-to-capability table', () => {
  it('gives every kind at most one capability', () => {
    for (const kind of [...EVENT_KINDS, 'garage.settings_changed']) {
      const matches = KIND_CAPABILITY.filter(([kinds]) => kinds.test(kind));
      expect([kind, matches.length <= 1]).toEqual([kind, true]);
    }
  });

  it('grants nothing through the garage by a right every mechanic holds', () => {
    const capabilities = KIND_CAPABILITY.map(([, capability]) => capability);

    expect(capabilities).not.toContain('garage.own_jobs');
    expect(capabilities).not.toContain('garage.audit_history');
  });
});
