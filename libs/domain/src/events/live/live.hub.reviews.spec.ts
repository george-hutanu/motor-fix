import { EventEmitter } from 'node:events';

import type { Role } from '@motor-fix/contracts/capabilities';

import { LiveHub } from './live.hub';
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

const NOW = Date.UTC(2026, 9, 25, 12, 0, 0);
const MINUTE = 60_000;
const ALL_RIGHTS = {
  canAnswerQuotes: true,
  canMoveBookings: true,
  canRecordFinalPrice: true,
};

const access = (): GarageAccess => ({
  mechanics: new Map([['elena', { ...ALL_RIGHTS }]]),
  off: new Set(),
  owners: new Set(['ion']),
  receptionists: new Set(['maria']),
});

let hub: LiveHub;

beforeEach(() => {
  jest.useFakeTimers({ now: NOW });
  hub = new LiveHub(jest.fn(async () => access()));
});

afterEach(() => {
  hub.shutdown();
  jest.useRealTimers();
});

const staff = (accountId: string, role: Role, mechanicId?: string) => {
  const sink = new Sink();
  hub.open(sink, {
    accountId,
    channels: [
      `account:${accountId}`,
      'system',
      'garage:g1',
      ...(mechanicId ? [`mechanic:${mechanicId}`] : []),
    ],
    expiresAt: NOW + 15 * MINUTE,
    garageId: 'g1',
    role,
  });
  return sink;
};

const deliver = (kind: string) =>
  hub.deliver(
    JSON.stringify({
      audience: ['garage:g1'],
      event: { at: new Date(NOW).toISOString(), id: kind, kind },
    }),
  );

// Every kind the garage's review list re-reads on.
const KINDS = [
  'review.posted',
  'review.edited',
  'review.deleted',
  'review.replied',
  'review.reply_edited',
  'review.reported',
  'review.decided',
  'review.appeal_decided',
  'rating.updated',
];

// @traces 074-FR-006 074-FR-017
describe("the garage channel's review messages", () => {
  it('reach the owner and the receptionist, never a mechanic, even one with every right', async () => {
    const owner = staff('ion', 'garage');
    const receptionist = staff('maria', 'receptionist');
    const mechanic = staff('elena', 'mechanic', 'm1');

    for (const kind of KINDS) await deliver(kind);

    expect(owner.kinds()).toEqual(KINDS);
    expect(receptionist.kinds()).toEqual(KINDS);
    expect(mechanic.kinds()).toEqual([]);
  });
});

// @traces 177-FR-010
describe("the admin channel's review messages", () => {
  const admin = () => {
    const sink = new Sink();
    hub.open(sink, {
      accountId: 'ana',
      channels: ['account:ana', 'system', 'admin'],
      expiresAt: NOW + 15 * MINUTE,
      garageId: null,
      role: 'admin',
    });
    return sink;
  };

  const toEveryone = (kind: string) =>
    hub.deliver(
      JSON.stringify({
        audience: ['admin', 'garage:g1', 'account:d1'],
        event: { at: new Date(NOW).toISOString(), id: kind, kind },
      }),
    );

  it('carry only what moves the reported reviews queue', async () => {
    const ana = admin();

    for (const kind of KINDS) await toEveryone(kind);
    await toEveryone('review.report_closed');
    await toEveryone('verification.decided');

    expect(ana.kinds()).toEqual([
      'review.deleted',
      'review.reported',
      'review.decided',
      'rating.updated',
      'review.report_closed',
      'verification.decided',
    ]);
  });
});
