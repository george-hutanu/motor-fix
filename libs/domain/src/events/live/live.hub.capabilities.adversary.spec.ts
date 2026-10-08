import { EventEmitter } from 'node:events';

import { EVENT_KINDS } from '@motor-fix/contracts';

import { KIND_CAPABILITY, LiveHub } from './live.hub';
import { capabilitiesOf, type Role } from '../../auth/capabilities';
import type { GarageAccess } from '../garage-access';

class Sink extends EventEmitter {
  chunks: string[] = [];
  write(chunk: string) {
    this.chunks.push(chunk);
    return true;
  }
  end() {}
  kinds() {
    return this.chunks
      .filter((c) => c.startsWith('event:'))
      .map((c) => (c.split('\n')[0] ?? '').replace(/^event: /, ''))
      .filter((k) => k !== 'hello');
  }
}

const NOW = Date.UTC(2026, 9, 5, 12, 0, 0);
const NONE = {
  canAnswerQuotes: false,
  canMoveBookings: false,
  canRecordFinalPrice: false,
};
const ALL = {
  canAnswerQuotes: true,
  canMoveBookings: true,
  canRecordFinalPrice: true,
};

const access = (over: Partial<GarageAccess> = {}): GarageAccess => ({
  mechanics: new Map([['elena', { ...NONE }]]),
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

const open = (accountId: string, role: Role, channels: string[]) => {
  const sink = new Sink();
  hub.open(sink, {
    accountId,
    channels: [`account:${accountId}`, 'system', ...channels],
    expiresAt: NOW + 15 * 60_000,
    garageId: 'g1',
    role,
  });
  return sink;
};

const staff = (accountId: string, role: Role, mechanicId?: string) =>
  open(
    accountId,
    role,
    mechanicId ? ['garage:g1', `mechanic:${mechanicId}`] : ['garage:g1'],
  );

const fanOut = (audience: string[], kind: string, id = 'e1') =>
  hub.deliver(
    JSON.stringify({
      audience,
      event: { at: new Date(NOW).toISOString(), id, kind },
    }),
  );

const heard = async (stream: Sink, kind: string) => {
  await fanOut(['garage:g1'], kind);
  return stream.kinds().includes(kind);
};

describe('kind families', () => {
  const familiesOf = (kind: string) =>
    KIND_CAPABILITY.filter(([re]) => re.test(kind));

  // "At most one family per kind" and "no family needs own_jobs or
  // audit_history" live in live.hub.audience.spec.ts (the kind-to-capability table).

  it.each([
    ['reviewer.x'],
    ['review'],
    ['garage.updated_x'],
    ['garage.updated.x'],
    ['xgarage.updated'],
    ['invite'],
    ['invitee.sent'],
    ['members.x'],
    ['mechanics.x'],
    ['price_lists.x'],
    ['requests.x'],
    ['messages.x'],
    ['booking.mov'],
    ['booking'],
    ['garage.settings_changed_x'],
    ['garage.features_changed.x'],
    ['REVIEW.posted'],
  ])('puts the near-miss kind %s in no family', (kind) => {
    expect(familiesOf(kind)).toEqual([]);
  });

  it.each([
    ['booking.mover', 'garage.schedule'],
    ['booking.move_lapsed', 'garage.schedule'],
    ['review.', 'garage.reviews'],
    ['invite.sent', 'garage.team'],
    ['garage.updated', 'garage.profile'],
  ])('puts %s in the family needing %s', (kind, cap) => {
    expect(familiesOf(kind).map(([, c]) => c)).toEqual([cap]);
  });
});

describe('a receptionist through the garage channel', () => {
  it.each([
    'reviewer.x',
    'garage.updated_x',
    'invite',
    'booking.mover',
    'quote.sent',
  ])('hears the unmapped or schedule kind %s', async (kind) => {
    const maria = staff('maria', 'receptionist');
    expect(await heard(maria, kind)).toBe(true);
  });

  it.each([
    'review.posted',
    'review.',
    'garage.updated',
    'invite.sent',
    'invite.revoked',
    'price_list.updated',
    'member.removed',
    'mechanic.updated',
    'garage.settings_changed',
    'garage.features_changed',
  ])('does not hear %s', async (kind) => {
    const maria = staff('maria', 'receptionist');
    expect(await heard(maria, kind)).toBe(false);
  });

  it('hears every kind exactly when its family capability is in the receptionist capabilities', async () => {
    const maria = staff('maria', 'receptionist');
    const caps = capabilitiesOf('receptionist', NONE);
    const kinds = [...EVENT_KINDS, 'garage.settings_changed'];
    let i = 0;
    for (const kind of kinds) {
      await fanOut(['garage:g1'], kind, `e${i++}`);
    }
    const expected = kinds.filter((k) => {
      const family = KIND_CAPABILITY.find(([re]) => re.test(k));
      return !family || caps.includes(family[1]);
    });
    expect(maria.kinds()).toEqual(expected);
  });

  it('still hears a review through the public key when it also meets the garage key', async () => {
    const maria = open('maria', 'receptionist', ['garage:g1', 'public:garage']);
    await fanOut(['garage:g1', 'public:garage'], 'review.posted');
    expect(maria.kinds()).toEqual(['review.posted']);
  });

  it('is judged as a receptionist when the same account is also a mechanic with every right', async () => {
    load.mockResolvedValue(
      access({ mechanics: new Map([['maria', { ...ALL }]]) }),
    );
    const maria = staff('maria', 'receptionist');
    expect(await heard(maria, 'review.posted')).toBe(false);
    expect(await heard(maria, 'quote.sent')).toBe(true);
  });

  it('is judged as a mechanic when a mechanic-role stream belongs to a listed receptionist', async () => {
    const asMechanic = staff('maria', 'mechanic', 'm9');
    expect(await heard(asMechanic, 'quote.sent')).toBe(false);
    expect(await heard(asMechanic, 'request.created')).toBe(false);
  });

  it('hears nothing through the garage once removed from the receptionists', async () => {
    load.mockResolvedValue(access({ receptionists: new Set() }));
    const maria = staff('maria', 'receptionist');
    expect(await heard(maria, 'quote.sent')).toBe(false);
  });
});

describe('an owner through the garage channel', () => {
  it('hears every contract kind and the settings kind', async () => {
    const ion = staff('ion', 'garage');
    const kinds = [...EVENT_KINDS, 'garage.settings_changed'];
    let i = 0;
    for (const kind of kinds) await fanOut(['garage:g1'], kind, `e${i++}`);
    expect(ion.kinds()).toEqual(kinds);
  });

  it('hears nothing through the garage when not listed as an owner', async () => {
    load.mockResolvedValue(access({ owners: new Set() }));
    const ion = staff('ion', 'garage');
    expect(await heard(ion, 'quote.sent')).toBe(false);
  });

  it('is judged as an owner when the account is also listed as a receptionist', async () => {
    load.mockResolvedValue(access({ receptionists: new Set(['ion']) }));
    const ion = staff('ion', 'garage');
    expect(await heard(ion, 'review.posted')).toBe(true);
  });
});

describe('roles that are not garage staff on a garage key', () => {
  it.each(['driver', 'admin'] as const)(
    'gives a %s stream listed nowhere nothing through the garage key',
    async (role) => {
      const sink = open('ion', role, ['garage:g1']);
      expect(await heard(sink, 'quote.sent')).toBe(false);
      expect(await heard(sink, 'review.posted')).toBe(false);
    },
  );
});

describe('a mechanic through the garage channel', () => {
  const mechanicWith = (rights: unknown) => {
    load.mockResolvedValue(
      access({
        mechanics: new Map([['elena', rights as typeof NONE]]),
      }),
    );
    return staff('elena', 'mechanic', 'm1');
  };

  it('hears nothing through the garage when the rights object is empty', async () => {
    const elena = mechanicWith({});
    expect(await heard(elena, 'request.created')).toBe(false);
    expect(await heard(elena, 'booking.moved')).toBe(false);
  });

  it('hears nothing when a right is undefined, null, a string or a number', async () => {
    const elena = mechanicWith({
      canAnswerQuotes: 'true',
      canMoveBookings: 1,
      canRecordFinalPrice: null,
    });
    expect(await heard(elena, 'request.created')).toBe(false);
    expect(await heard(elena, 'booking.moved')).toBe(false);
  });

  it('hears requests with only the right to answer quotes, and not booking moves', async () => {
    const elena = mechanicWith({ canAnswerQuotes: true });
    expect(await heard(elena, 'request.created')).toBe(true);
    expect(await heard(elena, 'message.sent')).toBe(true);
    expect(await heard(elena, 'booking.moved')).toBe(false);
  });

  it('hears every booking.move kind with only the right to move bookings', async () => {
    const elena = mechanicWith({ canMoveBookings: true });
    for (const kind of [
      'booking.move_proposed',
      'booking.moved',
      'booking.move_lapsed',
      'booking.move_refused',
      'booking.mover',
    ]) {
      expect([kind, await heard(elena, kind)]).toEqual([kind, true]);
    }
    expect(await heard(elena, 'request.created')).toBe(false);
  });

  it('hears nothing through the garage when the account is not a listed mechanic', async () => {
    load.mockResolvedValue(access({ mechanics: new Map() }));
    const elena = staff('elena', 'mechanic', 'm1');
    expect(await heard(elena, 'request.created')).toBe(false);
  });

  it.each([
    'quote.sent',
    'booking.confirmed',
    'booking.created',
    'job.started',
    'review.posted',
    'reviewer.x',
    'garage.updated',
    'invite.sent',
    'invite',
    'price_list.updated',
    'member.removed',
    'garage.features_changed',
    'garage.slots_changed',
  ])(
    'does not hear %s on the garage key even with every right',
    async (kind) => {
      load.mockResolvedValue(
        access({ mechanics: new Map([['elena', { ...ALL }]]) }),
      );
      const elena = staff('elena', 'mechanic', 'm1');
      expect(await heard(elena, kind)).toBe(false);
    },
  );

  it('hears job and booking kinds on its own mechanic key with no rights', async () => {
    const elena = staff('elena', 'mechanic', 'm1');
    await fanOut(['garage:g1', 'mechanic:m1'], 'job.started', 'a');
    await fanOut(['garage:g1', 'mechanic:m1'], 'booking.confirmed', 'b');
    expect(elena.kinds()).toEqual(['job.started', 'booking.confirmed']);
  });

  it('judges the next event on new rights after a mechanic update', async () => {
    const elena = staff('elena', 'mechanic', 'm1');
    expect(await heard(elena, 'request.created')).toBe(false);
    load.mockResolvedValue(
      access({
        mechanics: new Map([['elena', { ...NONE, canAnswerQuotes: true }]]),
      }),
    );
    await fanOut(['garage:g1'], 'mechanic.updated', 'u1');
    await fanOut(['garage:g1'], 'request.created', 'r2');
    expect(elena.kinds()).toEqual(['request.created']);
  });
});

describe('feature switches and the garage channel', () => {
  it('drops media kinds for an owner when live_media is off', async () => {
    load.mockResolvedValue(access({ off: new Set(['live_media']) }));
    const ion = staff('ion', 'garage');
    expect(await heard(ion, 'media.added')).toBe(false);
    expect(await heard(ion, 'quote.sent')).toBe(true);
  });
});
