// jsdom has neither the Web Locks API nor a cross-tab channel: these stand in
// for one browser's, shared by every Live built in a test as by every tab.

type Grant = () => Promise<unknown>;

class FakeLocks {
  private readonly held = new Set<string>();
  private readonly waiting = new Map<string, Grant[]>();
  readonly requested: string[] = [];

  request(
    name: string,
    options: { signal?: AbortSignal },
    callback: () => Promise<unknown>,
  ): Promise<unknown> {
    this.requested.push(name);
    return new Promise((resolve, reject) => {
      const grant: Grant = async () => {
        this.held.add(name);
        try {
          resolve(await callback());
        } catch (error) {
          reject(error);
        } finally {
          this.held.delete(name);
          this.waiting.get(name)?.shift()?.();
        }
      };
      if (!this.held.has(name)) {
        void grant();
        return;
      }
      const queue = this.waiting.get(name) ?? [];
      queue.push(grant);
      this.waiting.set(name, queue);
      options.signal?.addEventListener('abort', () => {
        const at = queue.indexOf(grant);
        if (at === -1) return;
        queue.splice(at, 1);
        reject(new DOMException('aborted', 'AbortError'));
      });
    });
  }

  isHeld(name: string) {
    return this.held.has(name);
  }
}

export class FakeChannel {
  static open: FakeChannel[] = [];
  onmessage: ((event: { data: unknown }) => void) | null = null;
  closed = false;

  constructor(readonly name: string) {
    FakeChannel.open.push(this);
  }

  // Like the browser's: never to itself, a copy, a task later.
  postMessage(data: unknown) {
    if (this.closed) throw new DOMException('closed', 'InvalidStateError');
    const copy = JSON.parse(JSON.stringify(data));
    for (const other of FakeChannel.open) {
      if (other === this || other.closed || other.name !== this.name) continue;
      void Promise.resolve().then(() => other.onmessage?.({ data: copy }));
    }
  }

  close() {
    this.closed = true;
    FakeChannel.open = FakeChannel.open.filter((c) => c !== this);
  }
}

const browser = globalThis as { BroadcastChannel?: unknown };
const original = {
  channel: browser.BroadcastChannel,
  locks: (navigator as { locks?: unknown }).locks,
};

const setLocks = (value: unknown) =>
  Object.defineProperty(navigator, 'locks', { configurable: true, value });

// Gives this test file's browser a lock manager and a channel; answers the
// lock manager so a test can see who holds what.
export function withTabs() {
  const locks = new FakeLocks();
  FakeChannel.open = [];
  setLocks(locks);
  browser.BroadcastChannel = FakeChannel;
  return locks;
}

// Puts back what the test environment had.
export function withoutTabs() {
  setLocks(original.locks);
  browser.BroadcastChannel = original.channel;
}
