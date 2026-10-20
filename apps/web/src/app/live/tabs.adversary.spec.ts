import type { LiveMessage } from '@motor-fix/contracts';

import { FakeChannel, withoutTabs, withTabs } from './tab-fakes.testing';
import { openLiveTabs, type TabMessage } from './tabs';

const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

const ping: LiveMessage = {
  at: '2026-10-19T12:00:00.000Z',
  id: 'x',
  kind: 'live.test',
};

afterEach(() => withoutTabs());

// @traces 1190-FR-010
describe('openLiveTabs: where it must give up', () => {
  it('answers null before the account is known', () => {
    withTabs();

    expect(openLiveTabs(() => null)).toBeNull();
    expect(openLiveTabs(() => '')).toBeNull();
    expect(FakeChannel.open).toEqual([]);
  });

  it('answers null without a lock manager and opens no channel', () => {
    withTabs();
    Object.defineProperty(navigator, 'locks', {
      configurable: true,
      value: undefined,
    });

    expect(openLiveTabs(() => 'a1:driver')).toBeNull();
    expect(FakeChannel.open).toEqual([]);
  });

  it('answers null when the lock manager has no request', () => {
    withTabs();
    Object.defineProperty(navigator, 'locks', {
      configurable: true,
      value: {},
    });

    expect(openLiveTabs(() => 'a1:driver')).toBeNull();
  });

  it('answers null without a broadcast channel and requests no lock', () => {
    const locks = withTabs();
    (globalThis as { BroadcastChannel?: unknown }).BroadcastChannel = undefined;

    expect(openLiveTabs(() => 'a1:driver')).toBeNull();
    expect(locks.requested).toEqual([]);
  });

  it('reads the name once, at open', () => {
    withTabs();
    const name = jest.fn(() => 'a1:driver');

    openLiveTabs(name)?.close();

    expect(name).toHaveBeenCalledTimes(1);
  });
});

// @traces 1190-FR-007
describe('openLiveTabs: the lock', () => {
  it('names the lock and the channel after the account and the role', async () => {
    const locks = withTabs();
    const abort = new AbortController();
    const tabs = openLiveTabs(() => 'a1:driver');

    await tabs?.hold(abort.signal);

    expect(locks.requested).toEqual(['mf-live:a1:driver']);
    expect(FakeChannel.open.map((c) => c.name)).toEqual(['mf-live:a1:driver']);
    abort.abort();
  });

  it('holds a lock apart for each role of one account', async () => {
    const locks = withTabs();
    const a = new AbortController();
    const b = new AbortController();
    const driver = openLiveTabs(() => 'a1:driver');
    const garage = openLiveTabs(() => 'a1:garage');

    await driver?.hold(a.signal);
    await garage?.hold(b.signal);

    expect(locks.isHeld('mf-live:a1:driver')).toBe(true);
    expect(locks.isHeld('mf-live:a1:garage')).toBe(true);
    a.abort();
    b.abort();
  });

  it('keeps a second tab waiting while the first holds, then grants it on release', async () => {
    withTabs();
    const first = new AbortController();
    const second = new AbortController();
    const one = openLiveTabs(() => 'a1:driver');
    const two = openLiveTabs(() => 'a1:driver');
    let granted = false;

    await one?.hold(first.signal);
    void two?.hold(second.signal).then(() => {
      granted = true;
    });
    await flush();
    expect(granted).toBe(false);

    first.abort();
    await flush();

    expect(granted).toBe(true);
    second.abort();
  });

  it('rejects a waiting tab whose signal aborts and never grants it afterwards', async () => {
    withTabs();
    const first = new AbortController();
    const second = new AbortController();
    const one = openLiveTabs(() => 'a1:driver');
    const two = openLiveTabs(() => 'a1:driver');
    await one?.hold(first.signal);
    const waiting = two?.hold(second.signal);

    second.abort();
    await expect(waiting).rejects.toBeDefined();
    first.abort();
    await flush();

    const third = new AbortController();
    const three = openLiveTabs(() => 'a1:driver');
    await expect(three?.hold(third.signal)).resolves.toBeUndefined();
    third.abort();
  });

  it('gives the lock to the next tab when the holder aborts twice', async () => {
    withTabs();
    const first = new AbortController();
    const one = openLiveTabs(() => 'a1:driver');
    const two = openLiveTabs(() => 'a1:driver');
    await one?.hold(first.signal);
    const next = two?.hold(new AbortController().signal);

    first.abort();
    first.abort();

    await expect(next).resolves.toBeUndefined();
  });
});

// @traces 1190-FR-007
describe('openLiveTabs: the channel', () => {
  it('hands a message to the other tab and never to the sender', async () => {
    withTabs();
    const one = openLiveTabs(() => 'a1:driver');
    const two = openLiveTabs(() => 'a1:driver');
    const heardOne: TabMessage[] = [];
    const heardTwo: TabMessage[] = [];
    one?.messages.subscribe((m) => heardOne.push(m));
    two?.messages.subscribe((m) => heardTwo.push(m));

    one?.post({ message: ping, position: '9', type: 'message' });
    await flush();

    expect(heardOne).toEqual([]);
    expect(heardTwo).toEqual([
      { message: ping, position: '9', type: 'message' },
    ]);
  });

  it('keeps the roles of one account apart', async () => {
    withTabs();
    const driver = openLiveTabs(() => 'a1:driver');
    const garage = openLiveTabs(() => 'a1:garage');
    const heard: TabMessage[] = [];
    garage?.messages.subscribe((m) => heard.push(m));

    driver?.post({ type: 'resync' });
    await flush();

    expect(heard).toEqual([]);
  });

  it('keeps two accounts apart', async () => {
    withTabs();
    const one = openLiveTabs(() => 'a1:driver');
    const other = openLiveTabs(() => 'a2:driver');
    const heard: TabMessage[] = [];
    other?.messages.subscribe((m) => heard.push(m));

    one?.post({ type: 'hello' });
    await flush();

    expect(heard).toEqual([]);
  });

  it('does not throw when posting after close, nor when closing twice', () => {
    withTabs();
    const tabs = openLiveTabs(() => 'a1:driver');

    tabs?.close();

    expect(() => tabs?.post({ type: 'hello' })).not.toThrow();
    expect(() => tabs?.close()).not.toThrow();
  });

  it('completes its messages on close', () => {
    withTabs();
    const tabs = openLiveTabs(() => 'a1:driver');
    const done = jest.fn();
    tabs?.messages.subscribe({ complete: done });

    tabs?.close();

    expect(done).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['null', null],
    ['a string', 'resync'],
    ['a number', 7],
    ['an object without a type', { state: 'open' }],
    ['an unknown type', { type: 'launch' }],
  ])(
    'hands its subscribers nothing for %s on the channel',
    async (_n, junk) => {
      withTabs();
      const tabs = openLiveTabs(() => 'a1:driver');
      const heard: unknown[] = [];
      tabs?.messages.subscribe((m) => heard.push(m));
      const stranger = new FakeChannel('mf-live:a1:driver');

      stranger.postMessage(junk);
      await flush();

      expect(heard).toEqual([]);
    },
  );
});
