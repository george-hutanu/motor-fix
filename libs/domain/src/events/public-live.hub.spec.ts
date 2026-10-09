import { EventEmitter } from 'node:events';

import { EVENT_KINDS } from '@motor-fix/contracts';
import { Logger } from '@nestjs/common';

import { LiveHub } from './live/live.hub';

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
  messages() {
    return this.chunks
      .filter((c) => c.startsWith('event:'))
      .map((c) => {
        const [event, data] = c.split('\n');
        return {
          data: JSON.parse((data ?? '').replace(/^data: /, '')),
          event: (event ?? '').replace(/^event: /, ''),
        };
      });
  }
  events() {
    return this.messages()
      .map((m) => m.event)
      .filter((kind) => kind !== 'hello' && kind !== 'bye');
  }
  pings() {
    return this.chunks.filter((c) => c.startsWith(':')).length;
  }
}

const NOW = Date.UTC(2026, 9, 7, 12, 0, 0);
const GARAGE = 'g1';
const MECHANIC = 'm1';
const BRAND = 'b1';

const REVIEW_KINDS = [
  'review.posted',
  'review.edited',
  'review.deleted',
  'review.replied',
  'review.reply_edited',
  'review.reported',
  'review.decided',
  'review.appeal_decided',
];

const ALLOWED: Record<string, string[]> = {
  [`public:garage:${GARAGE}`]: [
    'garage.updated',
    'price_list.updated',
    'mechanic.updated',
    'facility.removed',
    'facility.re_add_decided',
    ...REVIEW_KINDS,
    'garage.suspended',
    'garage.restored',
    'garage.slots_changed',
    // @traces 384-FR-009
    'response_stats.updated',
  ],
  [`public:mechanic:${MECHANIC}`]: ['mechanic.updated', ...REVIEW_KINDS],
  'public:search': [
    'verification.decided',
    'garage.suspended',
    'garage.restored',
    'garage.updated',
  ],
  [`public:search:${BRAND}`]: ['garage.updated'],
  system: [
    'platform_rule.changed',
    'platform_rule.change_requested',
    'platform_rule.change_decided',
  ],
};

let hub: LiveHub;

beforeEach(() => {
  jest.useFakeTimers({ now: NOW });
  hub = new LiveHub(async () => ({
    mechanics: new Map(),
    off: new Set(),
    owners: new Set(),
    receptionists: new Set(),
  }));
});

afterEach(() => {
  hub.shutdown();
  jest.useRealTimers();
  jest.restoreAllMocks();
});

const openPublic = (channels: string[], address: string | null = '1.2.3.4') => {
  const sink = new Sink();
  const id = hub.open(sink, { address, channels, public: true });
  return { id, sink };
};

const event = (kind: string, extra: Record<string, unknown> = {}) => ({
  at: new Date(NOW).toISOString(),
  id: '7d8e5d4a-1f7a-4c0b-9a51-3a3b6a1c2d01',
  kind,
  ...extra,
});

const fanOut = (audience: string[], kind: string, extra = {}) =>
  hub.deliver(JSON.stringify({ audience, event: event(kind, extra) }));

describe('LiveHub public streams', () => {
  it('greets a public stream with hello and its connection id', () => {
    const { id, sink } = openPublic(['system']);

    expect(id).toEqual(expect.any(String));
    expect(sink.messages()).toEqual([
      { data: expect.objectContaining({ id, kind: 'hello' }), event: 'hello' },
    ]);
  });

  it('carries each kind on exactly the public keys that allow it', async () => {
    for (const [key, allowed] of Object.entries(ALLOWED)) {
      const { sink } = openPublic([key]);
      for (const kind of EVENT_KINDS) await fanOut([key], kind);

      expect({ key, kinds: sink.events() }).toEqual({
        key,
        kinds: EVENT_KINDS.filter((kind) => allowed.includes(kind)),
      });
    }
  });

  it('carries a kind to a public stream when any key it met allows it', async () => {
    const { sink } = openPublic([`public:search:${BRAND}`, 'public:search']);

    await fanOut(
      [`garage:${GARAGE}`, 'public:search', `public:search:${BRAND}`],
      'garage.suspended',
    );

    expect(sink.events()).toEqual(['garage.suspended']);
  });

  it('never carries a private kind to a public stream, whatever audience the publisher named', async () => {
    const keys = Object.keys(ALLOWED);
    const { sink } = openPublic(keys);
    const privateKinds = EVENT_KINDS.filter((kind) =>
      /^(request|quote|booking|job|media|live|message|car|repair|account|member|invite|document|assistant)/.test(
        kind,
      ),
    );

    for (const kind of privateKinds) await fanOut(keys, kind);

    expect(sink.events()).toEqual([]);
  });

  it('sends only the kind, id and time, whatever else the publisher put in', async () => {
    const { sink } = openPublic([`public:garage:${GARAGE}`]);

    await fanOut([`public:garage:${GARAGE}`], 'review.posted', {
      authorAccountId: 'd1',
      body: 'Slow and expensive',
      rating: 1,
    });

    expect(sink.messages().at(-1)?.data).toEqual({
      at: new Date(NOW).toISOString(),
      id: '7d8e5d4a-1f7a-4c0b-9a51-3a3b6a1c2d01',
      kind: 'review.posted',
    });
  });

  it('keeps a signed-in stream on the same key getting what it got before', async () => {
    const sink = new Sink();
    hub.open(sink, {
      accountId: 'a1',
      channels: ['account:a1', 'system'],
      expiresAt: NOW + 15 * 60_000,
      garageId: null,
      role: 'driver',
    });

    await fanOut(['account:a1'], 'car.updated');

    expect(sink.events()).toEqual(['car.updated']);
  });

  it('writes a comment line to a quiet public stream every 25 seconds', () => {
    const { sink } = openPublic(['system']);

    jest.advanceTimersByTime(24_999);
    expect(sink.pings()).toBe(0);
    jest.advanceTimersByTime(1);
    expect(sink.pings()).toBe(1);
    jest.advanceTimersByTime(25_000);
    expect(sink.pings()).toBe(2);
  });

  it('never expires a public stream', () => {
    const { sink } = openPublic(['system']);

    jest.advanceTimersByTime(24 * 60 * 60_000);

    expect(sink.ended).toBe(false);
  });

  it('never ends a public stream for an account event', async () => {
    const { id, sink } = openPublic(['system']);

    await fanOut(['account:x'], 'account.suspended', { id });
    await fanOut(['account:x'], 'account.deleted', { id });

    expect(sink.ended).toBe(false);
  });

  it('says bye with reason shutdown to a public stream when the copy shuts down', () => {
    const { sink } = openPublic(['system']);

    hub.shutdown();

    expect(sink.messages().at(-1)).toMatchObject({
      data: { kind: 'bye', reason: 'shutdown' },
    });
    expect(sink.ended).toBe(true);
  });

  describe('places per address', () => {
    it('gives one address 20 public streams and refuses the 21st', () => {
      for (let i = 0; i < 20; i++) {
        expect(hub.publicPlace('1.2.3.4')).toBe(true);
        openPublic(['system'], '1.2.3.4');
      }

      expect(hub.publicPlace('1.2.3.4')).toBe(false);
      expect(hub.publicPlace('5.6.7.8')).toBe(true);
    });

    it('frees the place of a public stream that closed', () => {
      const streams = Array.from({ length: 20 }, () =>
        openPublic(['system'], '1.2.3.4'),
      );

      streams[0]?.sink.emit('close');

      expect(hub.publicPlace('1.2.3.4')).toBe(true);
    });

    it('frees the place of a public stream the copy said bye to', () => {
      Array.from({ length: 20 }, () => openPublic(['system'], '1.2.3.4'));

      hub.shutdown();

      expect(hub.publicPlace('1.2.3.4')).toBe(true);
    });

    it('counts a closed stream once however often it closes', () => {
      const streams = Array.from({ length: 20 }, () =>
        openPublic(['system'], '1.2.3.4'),
      );

      streams[0]?.sink.emit('close');
      streams[0]?.sink.emit('close');
      openPublic(['system'], '1.2.3.4');

      expect(hub.publicPlace('1.2.3.4')).toBe(false);
    });

    it('holds no place for a client that left before the stream opened', () => {
      for (let i = 0; i < 20; i++) {
        const gone = Object.assign(new Sink(), { destroyed: true });
        hub.open(gone, { address: '1.2.3.4', channels: [], public: true });
      }

      expect(hub.publicPlace('1.2.3.4')).toBe(true);
    });

    it('skips the limit for an address it cannot read, and logs it', () => {
      const warn = jest
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation(() => undefined);

      for (let i = 0; i < 25; i++) {
        expect(hub.publicPlace(null)).toBe(true);
        openPublic(['system'], null);
      }

      expect(warn).toHaveBeenCalledWith(expect.stringMatching(/address/));
    });

    it('does not count signed-in streams against an address', () => {
      for (let i = 0; i < 10; i++) {
        hub.open(new Sink(), {
          accountId: `a${i}`,
          channels: [`account:a${i}`],
          expiresAt: NOW + 15 * 60_000,
          garageId: null,
          role: 'driver',
        });
      }
      Array.from({ length: 19 }, () => openPublic(['system'], '1.2.3.4'));

      expect(hub.publicPlace('1.2.3.4')).toBe(true);
    });
  });
});
