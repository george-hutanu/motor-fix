import { isPlatformBrowser } from '@angular/common';
import {
  Injectable,
  inject,
  type OnDestroy,
  PLATFORM_ID,
  signal,
} from '@angular/core';
import type {
  EventKind,
  LiveByeReason,
  LiveMessage,
} from '@motor-fix/contracts';
import { filter, type Observable, Subject } from 'rxjs';

import { Session } from './session';
import { backoffDelay, readEvents, SILENT_FOR } from '../live/stream';
import { type LiveView, liveView } from '../live/view';

const RENEW_AFTER: readonly LiveByeReason[] = ['expired', 'shutdown'];
// After this many failed tries in a row the views are re-read on a timer.
const POLL_AFTER = 3;
const POLL_EVERY = 60_000;
const OFFLINE_AFTER = 10_000;
const ASLEEP_FOR = 60_000;

export type LiveState = 'closed' | 'reconnecting' | 'polling' | 'open';

type Outcome = 'failed' | 'renew' | 'unauthorized' | 'stop' | 'wake';

// The tab's one live connection. The access token lives in memory only, so
// the stream is read through fetch with the Authorization header: EventSource
// cannot send it, and it never goes in the address.
@Injectable({ providedIn: 'root' })
export class Live implements OnDestroy {
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

  constructor() {
    if (!this.browser) return;
    window.addEventListener('online', this.onOnline);
    window.addEventListener('offline', this.onOffline);
    document.addEventListener('visibilitychange', this.onVisibility);
  }

  ngOnDestroy() {
    this.close();
    if (!this.browser) return;
    window.removeEventListener('online', this.onOnline);
    window.removeEventListener('offline', this.onOffline);
    document.removeEventListener('visibilitychange', this.onVisibility);
  }

  open() {
    if (!this.browser || this.wanted) return;
    const wanted = new AbortController();
    this.wanted = wanted;
    this.failures = 0;
    this.status.set('reconnecting');
    this.startOfflineTimer();
    void this.run(wanted.signal);
  }

  close() {
    const wanted = this.wanted;
    this.wanted = null;
    wanted?.abort();
    this.attempt?.abort('stop');
    this.attempt = null;
    this.wake?.();
    this.settle('closed');
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

  // Tries, waits and renews until close(), an eviction or a refused renewal.
  private async run(wanted: AbortSignal) {
    const tab = { opened: false, renewed: false };
    while (!wanted.aborted && (await this.step(wanted, tab)));
    if (this.wanted?.signal === wanted) {
      this.wanted = null;
      this.settle('closed');
    }
  }

  // One try and what follows it; false ends the connection.
  private async step(
    wanted: AbortSignal,
    tab: { opened: boolean; renewed: boolean },
  ): Promise<boolean> {
    const outcome = await this.attemptOnce(wanted, () => {
      if (tab.opened) this.resyncs.next();
      tab.opened = true;
      tab.renewed = false;
    }).catch((): Outcome => 'stop');
    if (outcome === 'stop') return false;
    if (outcome === 'wake') return true;
    // A second 401 straight after a renewal is a failure, not another renewal.
    const renew =
      outcome === 'renew' || (outcome === 'unauthorized' && !tab.renewed);
    tab.renewed = renew;
    if (renew) return this.session.renew().catch(() => false);
    await this.backOff(wanted);
    return true;
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
    return attempt.signal.reason === 'wake' ? 'wake' : outcome;
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
      const reason = await readEvents(reader, attempt.signal, heard, (m) =>
        this.messages.next(m),
      );
      if (reason === 'evicted') return 'stop';
      return reason !== null && RENEW_AFTER.includes(reason)
        ? 'renew'
        : 'failed';
    } finally {
      clearTimeout(silence);
    }
  }

  private opened() {
    this.failures = 0;
    clearInterval(this.pollTimer);
    this.pollTimer = undefined;
    clearTimeout(this.offlineTimer);
    this.offlineTimer = undefined;
    this.isOffline.set(false);
    this.status.set('open');
  }

  // The stream is gone (or never came) while it is still wanted.
  private lost() {
    if (this.status() === 'open') this.status.set('reconnecting');
    this.startOfflineTimer();
  }

  private async backOff(wanted: AbortSignal) {
    this.failures++;
    if (this.failures >= POLL_AFTER && this.pollTimer === undefined) {
      this.status.set('polling');
      this.resyncs.next();
      this.pollTimer = setInterval(() => this.resyncs.next(), POLL_EVERY);
    }
    const delay = backoffDelay(this.failures);
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
      if (this.wanted && this.status() !== 'open') this.isOffline.set(true);
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
