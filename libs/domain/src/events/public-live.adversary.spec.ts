import { EventEmitter } from 'node:events';

import { EVENT_KINDS } from '@motor-fix/contracts';

import { audienceOf, type LiveSubject } from './audience';
import { LiveHub } from './live.hub';

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
  events() {
    return this.chunks
      .filter((c) => c.startsWith('event:'))
      .map((c) => (c.split('\n')[0] ?? '').replace(/^event: /, ''))
      .filter((kind) => kind !== 'hello' && kind !== 'bye');
  }
  byes() {
    return this.chunks.filter((c) => c.startsWith('event: bye')).length;
  }
}

const NOW = Date.UTC(2026, 9, 7, 12, 0, 0);
const at = new Date(NOW).toISOString();

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
  hub.open(sink, { address, channels, public: true });
  return sink;
};
const send = (audience: string[], kind: string) =>
  hub.deliver(JSON.stringify({ audience, event: { at, id: 'x-1', kind } }));

describe('public audience', () => {
  it('names the garage and mechanic channels with their ids for a review', () => {
    const keys = audienceOf({
      authorAccountId: 'a1',
      garageId: 'g1',
      mechanicId: 'm1',
      type: 'review',
    });

    expect(keys).toEqual(
      expect.arrayContaining([
        'garage:g1',
        'account:a1',
        'public:garage:g1',
        'public:mechanic:m1',
      ]),
    );
    expect(keys).not.toContain('public:garage');
    expect(keys).not.toContain('public:mechanic');
  });

  it('names no mechanic channel for a review that names no mechanic', () => {
    const keys = audienceOf({
      authorAccountId: 'a1',
      garageId: 'g1',
      mechanicId: null,
      type: 'review',
    });

    expect(keys.filter((k) => k.startsWith('public:'))).toEqual([
      'public:garage:g1',
    ]);
  });

  it('sends an approval to the garage page and the all-brands results', () => {
    const keys = audienceOf({
      garageId: 'g1',
      published: true,
      type: 'verification',
    });

    expect(keys.filter((k) => k.startsWith('public:')).sort()).toEqual([
      'public:garage:g1',
      'public:search',
    ]);
  });

  it('keeps a verification that is not an approval off every public key', () => {
    const keys = audienceOf({ garageId: 'g1', type: 'verification' });

    expect(keys.filter((k) => k.startsWith('public:'))).toEqual([]);
  });

  it('puts a garage change in the results only when it can move the garage there', () => {
    const inResults = audienceOf({
      garageId: 'g1',
      results: true,
      type: 'public_garage',
    });
    const pageOnly = audienceOf({
      garageId: 'g1',
      results: false,
      type: 'public_garage',
    });

    expect(inResults).toEqual(
      expect.arrayContaining([
        'garage:g1',
        'public:garage:g1',
        'public:search',
      ]),
    );
    expect(pageOnly).toEqual(
      expect.arrayContaining(['garage:g1', 'public:garage:g1']),
    );
    expect(pageOnly).not.toContain('public:search');
  });

  it('names a results channel for each changed brand and no other brand', () => {
    const keys = audienceOf({
      brandIds: ['b1', 'b2'],
      garageId: 'g1',
      type: 'garage_brands',
    });

    expect(keys).toEqual(
      expect.arrayContaining(['public:search:b1', 'public:search:b2']),
    );
    expect(keys.filter((k) => k.startsWith('public:search')).length).toBe(2);
  });

  it('names no results channel for a brand change that changed no brand', () => {
    const keys = audienceOf({
      brandIds: [],
      garageId: 'g1',
      type: 'garage_brands',
    });

    expect(keys.filter((k) => k.startsWith('public:search'))).toEqual([]);
  });

  it.each<LiveSubject>([
    { accountId: 'a1', type: 'account' },
    { driverAccountId: 'a1', garageIds: ['g1'], type: 'request' },
    { driverAccountId: 'a1', garageId: 'g1', type: 'quote' },
    { driverAccountId: 'a1', garageId: 'g1', type: 'message' },
    {
      driverAccountId: 'a1',
      garageId: 'g1',
      mechanicId: 'm1',
      type: 'booking',
    },
    { driverAccountId: 'a1', garageId: 'g1', mechanicId: 'm1', type: 'job' },
    { ownerAccountId: 'a1', type: 'car' },
    { ownerAccountId: 'a1', sharedGarageId: 'g1', type: 'repair' },
    { garageIds: ['g1'], type: 'garage' },
  ])('names no public key for a private subject: $type', (subject) => {
    expect(audienceOf(subject).filter((k) => k.startsWith('public:'))).toEqual(
      [],
    );
  });
});

describe('LiveHub public stream hostile input', () => {
  it('does not mix up a garage id that is a prefix of another', async () => {
    const sink = openPublic(['public:garage:g1']);

    await send(['public:garage:g10'], 'garage.updated');
    await send(['public:garage:'], 'garage.updated');
    await send(['public:garage'], 'garage.updated');

    expect(sink.events()).toEqual([]);
  });

  it('does not let a mechanic channel carry a garage-only kind', async () => {
    const sink = openPublic(['public:mechanic:m1']);

    await send(['public:mechanic:m1'], 'garage.suspended');
    await send(['public:mechanic:m1'], 'price_list.updated');

    expect(sink.events()).toEqual([]);
  });

  it('does not let a brand channel carry anything but garage.updated', async () => {
    const sink = openPublic(['public:search:b1']);

    for (const kind of EVENT_KINDS) await send(['public:search:b1'], kind);

    expect(sink.events()).toEqual(['garage.updated']);
  });

  it('carries no kind to a public stream that joined nothing', async () => {
    const sink = openPublic([]);

    for (const kind of EVENT_KINDS)
      await send(['public:garage:g1', 'public:search', 'garage:g1'], kind);

    expect(sink.events()).toEqual([]);
  });

  it('survives a payload that is not json and keeps delivering', async () => {
    const sink = openPublic(['public:garage:g1']);

    await hub.deliver('{not json');
    await hub.deliver('null');
    await hub.deliver('{}');
    await send(['public:garage:g1'], 'garage.updated');

    expect(sink.events()).toEqual(['garage.updated']);
  });

  it('delivers one event once to a stream that matches by several keys', async () => {
    const sink = openPublic(['public:garage:g1', 'public:search']);

    await send(['public:garage:g1', 'public:search'], 'garage.updated');

    expect(sink.events()).toEqual(['garage.updated']);
  });

  it('says bye once to a public stream when the copy shuts down twice', () => {
    const sink = openPublic(['system']);

    hub.shutdown();
    hub.shutdown();

    expect(sink.byes()).toBe(1);
  });

  it('never holds a place for a check that was refused or only asked', () => {
    for (let i = 0; i < 19; i++) openPublic(['system']);

    for (let i = 0; i < 100; i++) expect(hub.publicPlace('1.2.3.4')).toBe(true);
  });

  it('counts addresses apart, including ipv6 and ipv4-mapped forms of different hosts', () => {
    for (let i = 0; i < 20; i++) openPublic(['system'], '2001:db8::1');

    expect(hub.publicPlace('2001:db8::1')).toBe(false);
    expect(hub.publicPlace('2001:db8::2')).toBe(true);
    expect(hub.publicPlace('::ffff:1.2.3.4')).toBe(true);
  });

  it('refuses a new stream from a full address and frees it again after one closes', () => {
    const sinks = Array.from({ length: 20 }, () => openPublic(['system']));
    expect(hub.publicPlace('1.2.3.4')).toBe(false);

    sinks[19]?.emit('close');

    expect(hub.publicPlace('1.2.3.4')).toBe(true);
    openPublic(['system']);
    expect(hub.publicPlace('1.2.3.4')).toBe(false);
  });

  it('stops delivering to a public stream that closed', async () => {
    const sink = openPublic(['public:garage:g1']);

    sink.emit('close');
    await send(['public:garage:g1'], 'garage.updated');

    expect(sink.events()).toEqual([]);
  });

  it('delivers a system kind to every public stream whatever its address', async () => {
    const a = openPublic(['system'], '1.1.1.1');
    const b = openPublic(['system'], null);

    await send(['system'], 'platform_rule.changed');

    expect([a.events(), b.events()]).toEqual([
      ['platform_rule.changed'],
      ['platform_rule.changed'],
    ]);
  });
});
