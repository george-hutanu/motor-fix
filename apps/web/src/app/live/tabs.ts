import type { LiveMessage } from '@motor-fix/contracts';
import { type Observable, Subject } from 'rxjs';

import { isLiveMessage, POSITION } from './stream';

// A signed-in live connection's state, as the tab holding it reports it.
export type LiveState = 'closed' | 'reconnecting' | 'polling' | 'open';

// What the tabs of one account and role tell each other over their channel:
// the tab holding the stream sends what it reads and how it stands, a tab
// that joins says hello and is answered with the state.
export type TabMessage =
  | { type: 'message'; message: LiveMessage; position?: string }
  | { type: 'state'; state: LiveState; offline: boolean }
  | { type: 'resync' }
  | { type: 'hello' };

export interface LiveTabs {
  // Resolves once this tab holds the browser's stream; it holds it until the
  // signal aborts. Rejects when the signal aborts before then.
  hold(signal: AbortSignal): Promise<void>;
  post(message: TabMessage): void;
  readonly messages: Observable<TabMessage>;
  close(): void;
}

const STATES: ReadonlySet<unknown> = new Set<LiveState>([
  'closed',
  'reconnecting',
  'polling',
  'open',
]);

// Only what a tab of this app sends: anything else on the channel is dropped.
function isTabMessage(value: unknown): value is TabMessage {
  const m = value as Record<string, unknown> | null;
  switch (m?.['type']) {
    case 'hello':
    case 'resync':
      return true;
    case 'state':
      return STATES.has(m['state']) && typeof m['offline'] === 'boolean';
    case 'message':
      return (
        isLiveMessage(m['message']) &&
        (m['position'] === undefined ||
          (typeof m['position'] === 'string' && POSITION.test(m['position'])))
      );
    default:
      return false;
  }
}

interface LockManager {
  request(
    name: string,
    options: { signal?: AbortSignal },
    callback: () => Promise<unknown>,
  ): Promise<unknown>;
}

// The channel and lock for one browser's tabs of an account and role (`name`
// is "<accountId>:<role>"), or null where the browser has no Web Locks or
// BroadcastChannel, or before the account is known: each tab then keeps a
// stream of its own.
export function openLiveTabs(name: () => string | null): LiveTabs | null {
  const locks = (navigator as { locks?: LockManager }).locks;
  if (typeof locks?.request !== 'function') return null;
  if (typeof BroadcastChannel !== 'function') return null;
  const key = name();
  if (!key) return null;
  const id = `mf-live:${key}`;
  const channel = new BroadcastChannel(id);
  const messages = new Subject<TabMessage>();
  channel.onmessage = (event: MessageEvent<unknown>) => {
    if (isTabMessage(event.data)) messages.next(event.data);
  };
  return {
    close() {
      channel.close();
      messages.complete();
    },
    hold: (signal) =>
      new Promise<void>((granted, refused) => {
        locks
          .request(id, { signal }, () => {
            granted();
            return new Promise<void>((release) => {
              if (signal.aborted) release();
              else signal.addEventListener('abort', () => release());
            });
          })
          .catch(refused);
      }),
    messages: messages.asObservable(),
    post(message) {
      try {
        channel.postMessage(message);
      } catch {
        // A closed channel: this tab is leaving.
      }
    },
  };
}
