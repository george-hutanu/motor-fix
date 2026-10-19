import { FakeChannel, withoutTabs, withTabs } from './tab-fakes.testing';
import { openLiveTabs, type TabMessage } from './tabs';

const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

afterEach(() => withoutTabs());

// @traces 1190-FR-007
// @traces 1190-FR-010
describe('openLiveTabs', () => {
  it('gives nothing where the browser has no lock manager', () => {
    withTabs();
    Object.defineProperty(navigator, 'locks', {
      configurable: true,
      value: undefined,
    });

    expect(openLiveTabs(() => 'a1:driver')).toBeNull();
  });

  it('gives nothing where the browser has no cross-tab channel', () => {
    withTabs();
    (globalThis as { BroadcastChannel?: unknown }).BroadcastChannel = undefined;

    expect(openLiveTabs(() => 'a1:driver')).toBeNull();
  });

  it('gives nothing before it knows whose tabs these are', () => {
    withTabs();

    expect(openLiveTabs(() => null)).toBeNull();
  });

  it('reads the name only where the browser can share a stream', () => {
    const name = jest.fn(() => 'a1:driver');

    openLiveTabs(name);

    expect(name).not.toHaveBeenCalled();
  });

  it('names the lock and the channel after the account and role', async () => {
    const locks = withTabs();
    const tabs = openLiveTabs(() => 'a1:driver');

    await tabs?.hold(new AbortController().signal);

    expect(locks.requested).toEqual(['mf-live:a1:driver']);
    expect(FakeChannel.open.map((c) => c.name)).toEqual(['mf-live:a1:driver']);
  });

  it('holds the lock from its grant until the signal aborts', async () => {
    const locks = withTabs();
    const tabs = openLiveTabs(() => 'a1:driver');
    const holding = new AbortController();

    await tabs?.hold(holding.signal);
    expect(locks.isHeld('mf-live:a1:driver')).toBe(true);

    holding.abort();
    await flush();
    expect(locks.isHeld('mf-live:a1:driver')).toBe(false);
  });

  it('hands the lock to the next tab when the holder lets it go', async () => {
    withTabs();
    const first = openLiveTabs(() => 'a1:driver');
    const second = openLiveTabs(() => 'a1:driver');
    const holding = new AbortController();
    await first?.hold(holding.signal);
    let granted = false;
    void second?.hold(new AbortController().signal).then(() => {
      granted = true;
    });
    await flush();
    expect(granted).toBe(false);

    holding.abort();
    await flush();

    expect(granted).toBe(true);
  });

  it('refuses a hold given up before its grant', async () => {
    withTabs();
    const first = openLiveTabs(() => 'a1:driver');
    const second = openLiveTabs(() => 'a1:driver');
    await first?.hold(new AbortController().signal);
    const waiting = new AbortController();
    const held = second?.hold(waiting.signal);

    waiting.abort();

    await expect(held).rejects.toBeDefined();
  });

  it('keeps the tabs of another role apart', async () => {
    const locks = withTabs();
    const driver = openLiveTabs(() => 'a1:driver');
    const garage = openLiveTabs(() => 'a1:garage');
    const heard: TabMessage[] = [];
    garage?.messages.subscribe((m) => heard.push(m));

    await driver?.hold(new AbortController().signal);
    await garage?.hold(new AbortController().signal);
    driver?.post({ type: 'resync' });
    await flush();

    expect(locks.isHeld('mf-live:a1:driver')).toBe(true);
    expect(locks.isHeld('mf-live:a1:garage')).toBe(true);
    expect(heard).toEqual([]);
  });

  it('fans each message out to the other tabs, not to itself', async () => {
    withTabs();
    const holder = openLiveTabs(() => 'a1:driver');
    const follower = openLiveTabs(() => 'a1:driver');
    const own: TabMessage[] = [];
    const heard: TabMessage[] = [];
    holder?.messages.subscribe((m) => own.push(m));
    follower?.messages.subscribe((m) => heard.push(m));
    const message: TabMessage = {
      message: {
        at: '2026-10-19T12:00:00.000Z',
        id: 'n-1',
        kind: 'notification.created',
      },
      position: '7',
      type: 'message',
    };

    holder?.post(message);
    holder?.post({ offline: false, state: 'open', type: 'state' });
    await flush();

    expect(heard).toEqual([
      message,
      { offline: false, state: 'open', type: 'state' },
    ]);
    expect(own).toEqual([]);
  });

  it('hears nothing more once closed', async () => {
    withTabs();
    const holder = openLiveTabs(() => 'a1:driver');
    const follower = openLiveTabs(() => 'a1:driver');
    const heard: TabMessage[] = [];
    follower?.messages.subscribe((m) => heard.push(m));

    follower?.close();
    holder?.post({ type: 'resync' });
    await flush();

    expect(heard).toEqual([]);
  });
});
