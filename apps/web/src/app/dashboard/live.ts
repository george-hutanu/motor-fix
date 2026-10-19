import { isPlatformBrowser } from '@angular/common';
import {
  DestroyRef,
  Injectable,
  inject,
  PLATFORM_ID,
  signal,
} from '@angular/core';
import type {
  EventKind,
  LiveCloseReason,
  LiveMessage,
} from '@motor-fix/contracts';
import { VERIFICATION_QUEUE_MAX } from '@motor-fix/contracts/verification-target';
import { filter, type Observable, Subject, type Subscription } from 'rxjs';

import { Session } from './session';
import { backoffDelay, readEvents, SILENT_FOR } from '../live/stream';
import {
  type LiveState,
  type LiveTabs,
  openLiveTabs,
  type TabMessage,
} from '../live/tabs';
import { type LiveView, liveView } from '../live/view';

const RENEW_AFTER: readonly LiveCloseReason[] = ['expired', 'shutdown'];
// After this many failed tries in a row the views are re-read on a timer.
const POLL_AFTER = 3;
const POLL_EVERY = 60_000;
const OFFLINE_AFTER = 10_000;
const ASLEEP_FOR = 60_000;

export type { LiveState };

// `release` lets the browser's stream go to another tab and asks for it again.
type Outcome =
  | 'failed'
  | 'reconnect'
  | 'release'
  | 'renew'
  | 'unauthorized'
  | 'stop'
  | 'wake';

// What follows a stream the server ended, by the reason it gave.
function outcomeOf(reason: LiveCloseReason | null): Outcome {
  if (reason === 'evicted') return 'stop';
  if (reason === 'reconnect') return 'reconnect';
  return reason !== null && RENEW_AFTER.includes(reason) ? 'renew' : 'failed';
}

const later = (a: string, b: string | null) =>
  b === null || BigInt(a) > BigInt(b) ? a : b;

// The browser's one live connection per account and role. One tab holds it
// (a Web Lock) and passes what it reads to the others over a BroadcastChannel;
// where the browser has neither, each tab keeps its own. The access token
// lives in memory only, so the stream is read through fetch with the
// Authorization header: EventSource cannot send it, and it never goes in the
// address.
@Injectable({ providedIn: 'root' })
export class Live {
  private readonly session = inject(Session);
  private readonly browser = isPlatformBrowser(inject(PLATFORM_ID));
  private readonly messages = new Subject<LiveMessage>();
  readonly events = this.messages.asObservable();
  private readonly resyncs = new Subject<void>();
  // Every view re-reads its data: the stream may have missed events.
  readonly resync: Observable<void> = this.resyncs.asObservable();
  private readonly status = signal<LiveState>('closed');
  readonly state = this.status.asReadonly();
  private readonly isOffline = signal(false);
  // True once the connection has been wanted but missing for 10 s.
  readonly offline = this.isOffline.asReadonly();

  private wanted: AbortController | null = null;
  private attempt: AbortController | null = null;
  private tabs: LiveTabs | null = null;
  private heard: Subscription | null = null;
  // This tab holds the browser's stream for its account and role.
  private leading = false;
  // The latest position read, sent as Last-Event-ID so the server replays
  // what came after it.
  private position: string | null = null;
  // A stream was open, here or in the tab that held it: views re-read when
  // the next one opens.
  private streamed = false;
  // The wait the server asked for before the first reopen after a drop.
  private retry: number | null = null;
  // Closed for the back/forward cache, and wanted again when shown.
  private suspended = false;
  private failures = 0;
  private hiddenAt: number | null = null;
  private wake: (() => void) | null = null;
  private offlineTimer: ReturnType<typeof setTimeout> | undefined;
  private pollTimer: ReturnType<typeof setInterval> | undefined;

  private readonly onOnline = () => this.wake?.();
  // A stream can outlive the network without hearing it; this one is gone.
  private readonly onOffline = () => this.attempt?.abort('offline');
  private readonly onVisibility = () => {
    if (document.visibilityState === 'hidden') {
      this.hiddenAt ??= Date.now();
      return;
    }
    const slept =
      this.hiddenAt !== null && Date.now() - this.hiddenAt >= ASLEEP_FOR;
    this.hiddenAt = null;
    if (!slept || !this.wanted) return;
    this.failures = 0;
    this.attempt?.abort('wake');
    this.wake?.();
  };
  // A page in the back/forward cache keeps no stream, which would also keep
  // the lock from the other tabs.
  private readonly onPageHide = () => {
    if (!this.wanted) return;
    this.stop();
    this.suspended = true;
  };
  private readonly onPageShow = () => {
    if (!this.suspended) return;
    this.suspended = false;
    this.open();
  };

  constructor() {
    if (!this.browser) return;
    window.addEventListener('online', this.onOnline);
    window.addEventListener('offline', this.onOffline);
    window.addEventListener('pagehide', this.onPageHide);
    window.addEventListener('pageshow', this.onPageShow);
    document.addEventListener('visibilitychange', this.onVisibility);
    inject(DestroyRef).onDestroy(() => {
      this.close();
      window.removeEventListener('online', this.onOnline);
      window.removeEventListener('offline', this.onOffline);
      window.removeEventListener('pagehide', this.onPageHide);
      window.removeEventListener('pageshow', this.onPageShow);
      document.removeEventListener('visibilitychange', this.onVisibility);
    });
  }

  open() {
    if (!this.browser || this.wanted) return;
    const wanted = new AbortController();
    this.wanted = wanted;
    this.suspended = false;
    this.failures = 0;
    this.status.set('reconnecting');
    this.startOfflineTimer();
    this.tabs = openLiveTabs(() => {
      const account = this.session.current();
      return account ? `${account.id}:${account.role}` : null;
    });
    if (!this.tabs) {
      void this.run(wanted.signal);
      return;
    }
    this.heard = this.tabs.messages.subscribe((m) => this.fromTab(m));
    this.tabs.post({ type: 'hello' });
    void this.lead(wanted.signal, this.tabs);
  }

  // Stops the stream and forgets where it was: the next open may be another
  // account's.
  close() {
    this.stop();
    this.suspended = false;
    this.position = null;
    this.streamed = false;
    this.retry = null;
  }

  catchUp() {
    this.resyncs.next();
  }

  // The events of these kinds, about one object when an id is given.
  on(
    kinds: readonly EventKind[],
    { id }: { id?: string } = {},
  ): Observable<LiveMessage> {
    const wanted: ReadonlySet<string> = new Set(kinds);
    return this.events.pipe(
      filter((m) => wanted.has(m.kind) && (id === undefined || m.id === id)),
    );
  }

  private stop() {
    const wanted = this.wanted;
    this.wanted = null;
    this.leading = false;
    wanted?.abort();
    this.attempt?.abort('stop');
    this.attempt = null;
    this.wake?.();
    this.heard?.unsubscribe();
    this.heard = null;
    this.tabs?.close();
    this.tabs = null;
    this.settle('closed');
  }

  // Waits for the browser's stream, holds it until it ends or is let go, and
  // asks for it again after letting it go.
  private async lead(wanted: AbortSignal, tabs: LiveTabs) {
    while (!wanted.aborted) {
      const term = new AbortController();
      const end = () => term.abort();
      wanted.addEventListener('abort', end);
      try {
        const granted = await tabs.hold(term.signal).then(
          () => true,
          () => false,
        );
        if (!granted || wanted.aborted) return;
        this.leading = true;
        this.share();
        if ((await this.run(wanted)) !== 'release') return;
      } finally {
        this.leading = false;
        wanted.removeEventListener('abort', end);
        term.abort();
      }
    }
  }

  // What the tab holding the stream tells the others.
  private fromTab(message: TabMessage) {
    if (message.type === 'hello') {
      if (this.leading) this.share();
      return;
    }
    if (this.leading) return;
    if (message.type === 'message') {
      this.streamed = true;
      if (message.position)
        this.position = later(message.position, this.position);
      this.messages.next(message.message);
    } else if (message.type === 'resync') {
      this.resyncs.next();
    } else {
      this.streamed ||= message.state === 'open';
      clearTimeout(this.offlineTimer);
      this.offlineTimer = undefined;
      this.status.set(message.state);
      this.isOffline.set(message.offline);
    }
  }

  private share() {
    this.tabs?.post({
      offline: this.isOffline(),
      state: this.status(),
      type: 'state',
    });
  }

  private setStatus(state: LiveState) {
    this.status.set(state);
    if (this.leading) this.share();
  }

  private setOffline(offline: boolean) {
    this.isOffline.set(offline);
    if (this.leading) this.share();
  }

  private catchUpAll() {
    this.resyncs.next();
    if (this.leading) this.tabs?.post({ type: 'resync' });
  }

  // Tries, waits and renews until close(), an eviction, a refused renewal or
  // a stream let go to another tab.
  private async run(wanted: AbortSignal): Promise<Outcome> {
    const tab = { opened: this.streamed, renewed: false };
    let outcome: Outcome = 'stop';
    while (!wanted.aborted) {
      outcome = await this.step(wanted, tab);
      if (outcome === 'stop' || outcome === 'release') break;
    }
    if (outcome !== 'release' && this.wanted?.signal === wanted) {
      this.stop();
    }
    return outcome;
  }

  // One try and what follows it; `stop` ends the connection.
  private async step(
    wanted: AbortSignal,
    tab: { opened: boolean; renewed: boolean },
  ): Promise<Outcome> {
    const outcome = await this.attemptOnce(wanted, () => {
      if (tab.opened) this.catchUpAll();
      tab.opened = true;
      tab.renewed = false;
    }).catch((): Outcome => 'stop');
    if (outcome === 'stop' || outcome === 'release') return outcome;
    if (outcome === 'wake' || outcome === 'reconnect') return 'wake';
    // A second 401 straight after a renewal is a failure, not another renewal.
    const renew =
      outcome === 'renew' || (outcome === 'unauthorized' && !tab.renewed);
    tab.renewed = renew;
    if (renew)
      return (await this.session.renew().catch(() => false)) ? 'renew' : 'stop';
    await this.backOff(wanted);
    return 'failed';
  }

  private async attemptOnce(
    wanted: AbortSignal,
    onOpen: () => void,
  ): Promise<Outcome> {
    const token = this.session.token();
    if (!token) return 'stop';
    const attempt = new AbortController();
    this.attempt = attempt;
    const outcome = await this.stream(token, attempt, onOpen).catch(
      (): Outcome => 'failed',
    );
    if (this.attempt === attempt) this.attempt = null;
    if (wanted.aborted) return 'stop';
    this.lost();
    const reason = attempt.signal.reason;
    if (reason === 'wake') return 'wake';
    // Offline, another tab may still reach the server.
    if (reason === 'offline' && this.tabs) return 'release';
    return outcome;
  }

  private async stream(
    token: string,
    attempt: AbortController,
    onOpen: () => void,
  ): Promise<Outcome> {
    let silence: ReturnType<typeof setTimeout> | undefined;
    const heard = () => {
      clearTimeout(silence);
      silence = setTimeout(() => attempt.abort('silent'), SILENT_FOR);
    };
    // The same minute bounds a request whose answer never comes.
    heard();
    try {
      const res = await fetch('/api/v1/live', {
        headers: {
          Accept: 'text/event-stream',
          Authorization: `Bearer ${token}`,
          'ngsw-bypass': 'true',
          ...(this.position !== null && { 'Last-Event-ID': this.position }),
        },
        signal: attempt.signal,
      });
      // An answer that comes after the abort is not a stream.
      if (
        attempt.signal.aborted ||
        res.status === 401 ||
        !res.ok ||
        !res.body
      ) {
        void res.body?.cancel().catch(() => undefined);
        return res.status === 401 && !attempt.signal.aborted
          ? 'unauthorized'
          : 'failed';
      }
      const reader = res.body.getReader();
      attempt.signal.addEventListener(
        'abort',
        () => void reader.cancel().catch(() => undefined),
      );
      this.opened();
      onOpen();
      heard();
      const reason = await readEvents(
        reader,
        attempt.signal,
        heard,
        (message, id) => this.read(message, id),
        (ms) => {
          this.retry = ms;
        },
      );
      return outcomeOf(reason);
    } finally {
      clearTimeout(silence);
    }
  }

  private read(message: LiveMessage, id: string | undefined) {
    if (id !== undefined) this.position = later(id, this.position);
    this.messages.next(message);
    if (this.leading)
      this.tabs?.post({
        message,
        type: 'message',
        ...(id !== undefined && { position: id }),
      });
  }

  private opened() {
    this.failures = 0;
    this.streamed = true;
    clearInterval(this.pollTimer);
    this.pollTimer = undefined;
    clearTimeout(this.offlineTimer);
    this.offlineTimer = undefined;
    this.isOffline.set(false);
    this.setStatus('open');
  }

  // The stream is gone (or never came) while it is still wanted.
  private lost() {
    if (this.status() === 'open') this.setStatus('reconnecting');
    this.startOfflineTimer();
  }

  private async backOff(wanted: AbortSignal) {
    this.failures++;
    if (this.failures >= POLL_AFTER && this.pollTimer === undefined) {
      this.setStatus('polling');
      this.catchUpAll();
      this.pollTimer = setInterval(() => this.catchUpAll(), POLL_EVERY);
    }
    // The server's wait comes first after a drop, then the backoff.
    const delay =
      this.failures === 1 && this.retry !== null
        ? this.retry
        : backoffDelay(this.failures);
    // online or a long sleep ending wakes the wait early.
    await new Promise<void>((resolve) => {
      const done = () => {
        clearTimeout(timer);
        if (this.wake === done) this.wake = null;
        resolve();
      };
      const timer = setTimeout(done, delay);
      this.wake = done;
      if (wanted.aborted) done();
    });
  }

  private startOfflineTimer() {
    if (this.offlineTimer !== undefined || this.isOffline()) return;
    this.offlineTimer = setTimeout(() => {
      this.offlineTimer = undefined;
      if (this.wanted && this.status() !== 'open') this.setOffline(true);
    }, OFFLINE_AFTER);
  }

  private settle(state: LiveState) {
    clearTimeout(this.offlineTimer);
    this.offlineTimer = undefined;
    clearInterval(this.pollTimer);
    this.pollTimer = undefined;
    this.isOffline.set(false);
    this.status.set(state);
  }
}

// A view's data, read through the API and read again when an event of these
// kinds arrives about the object it shows (without `id`, about any object); a
// burst of 300 ms is one re-read.
// A background re-read that fails keeps the data and shows nothing; it reads
// again on the next event or after 60 s. Call it in an injection context.
export function liveResource<T>(
  load: () => Promise<T>,
  kinds: readonly EventKind[],
  id?: () => string,
): LiveView<T> {
  const live = inject(Live);
  return liveView(load, {
    changes: live.on(kinds).pipe(filter((m) => !id || m.id === id())),
    goneOn: [404],
    resync: live.resync,
    retryAfter: 60_000,
  });
}

// Every row shown, from offset 0, in reads of at most VERIFICATION_QUEUE_MAX
// rows (the most one read answers); a row that moved between two reads is
// kept once.
export async function pagedRead<R extends { id: string }>(
  wanted: number,
  read: (page: { limit: number; offset: number }) => Promise<{
    items: R[];
    total: number;
  }>,
): Promise<{ items: R[]; total: number }> {
  const reads: Promise<{ items: R[]; total: number }>[] = [];
  for (let offset = 0; offset < wanted; offset += VERIFICATION_QUEUE_MAX) {
    reads.push(
      read({
        limit: Math.min(VERIFICATION_QUEUE_MAX, wanted - offset),
        offset,
      }),
    );
  }
  const answers = await Promise.all(reads);
  const seen = new Set<string>();
  const items = answers
    .flatMap((answer) => answer.items)
    .filter((row) => !seen.has(row.id) && seen.add(row.id));
  return { items, total: answers[0]?.total ?? items.length };
}
