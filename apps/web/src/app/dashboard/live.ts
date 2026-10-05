import { isPlatformBrowser } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import {
  computed,
  DestroyRef,
  Injectable,
  inject,
  type OnDestroy,
  PLATFORM_ID,
  type Signal,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import type {
  EventKind,
  LiveByeReason,
  LiveMessage,
} from '@motor-fix/contracts';
import { debounceTime, filter, type Observable, Subject } from 'rxjs';

import { reuse } from './live-in-place';
import { Session } from './session';

const RENEW_AFTER: readonly LiveByeReason[] = ['expired', 'shutdown'];
// Milliseconds between failed tries; the last one repeats.
const BACKOFF = [1_000, 2_000, 5_000, 10_000, 30_000];
// After this many failed tries in a row the views are re-read on a timer.
const POLL_AFTER = 3;
const POLL_EVERY = 60_000;
// The server sends a heartbeat every 25 s; a minute of nothing is a dead stream.
const SILENT_FOR = 60_000;
const OFFLINE_AFTER = 10_000;
const ASLEEP_FOR = 60_000;

export type LiveState = 'closed' | 'reconnecting' | 'polling' | 'open';

type Outcome = 'failed' | 'renew' | 'unauthorized' | 'stop' | 'wake';

function parse(block: string): LiveMessage | null {
  const data = block
    .split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trimStart())
    .join('\n');
  if (!data) return null;
  try {
    const message = JSON.parse(data) as Partial<LiveMessage> | null;
    return typeof message?.kind === 'string' &&
      typeof message.id === 'string' &&
      typeof message.at === 'string'
      ? (message as LiveMessage)
      : null;
  } catch {
    return null;
  }
}

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
    document.addEventListener('visibilitychange', this.onVisibility);
  }

  ngOnDestroy() {
    this.close();
    if (!this.browser) return;
    window.removeEventListener('online', this.onOnline);
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
      const reason = await this.consume(reader, attempt.signal, heard);
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
    const base = BACKOFF[Math.min(this.failures, BACKOFF.length) - 1] ?? 0;
    const delay = Math.round(base * (0.9 + 0.2 * Math.random()));
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

  // Server-sent events arrive in blocks that end with a blank line; a chunk
  // may end in the middle of one. The loop ends when the server closes the
  // stream or an abort cancels the reader.
  private async consume(
    reader: ReadableStreamDefaultReader<Uint8Array>,
    signal: AbortSignal,
    heard: () => void,
  ) {
    const decoder = new TextDecoder();
    let buffer = '';
    let reason: LiveByeReason | null = null;
    for (;;) {
      const { done, value } = await reader.read();
      if (done || signal.aborted) return reason;
      heard();
      buffer = (buffer + decoder.decode(value, { stream: true })).replace(
        /\r\n/g,
        '\n',
      );
      const blocks = buffer.split('\n\n');
      buffer = blocks.pop() ?? '';
      reason = this.emit(blocks) ?? reason;
    }
  }

  private emit(blocks: string[]): LiveByeReason | null {
    let reason: LiveByeReason | null = null;
    for (const message of blocks.map(parse)) {
      if (!message) continue;
      if (message.kind === 'bye') reason = message.reason ?? null;
      this.messages.next(message);
    }
    return reason;
  }
}

interface LiveResource<T> {
  // The last data read; a re-read changes only its parts that changed.
  readonly value: Signal<T | undefined>;
  // Why the first read failed, while there is nothing to show.
  readonly error: Signal<unknown>;
  // The object is deleted or no longer the person's (the read answered 404).
  readonly gone: Signal<boolean>;
  // True only for the first read; a background re-read keeps the data shown.
  readonly isLoading: Signal<boolean>;
  reload(): void;
}

const RETRY_AFTER = 60_000;

// A view's data, read through the API and read again when an event of these
// kinds arrives about the object it shows; a burst of 300 ms is one re-read.
// A background re-read that fails keeps the data and shows nothing; it reads
// again on the next event or after 60 s. Call it in an injection context.
export function liveResource<T>(
  load: () => Promise<T>,
  kinds: readonly EventKind[],
  id: () => string,
): LiveResource<T> {
  const value = signal<T | undefined>(undefined);
  const error = signal<unknown>(undefined);
  const gone = signal(false);
  const isLoading = signal(false);
  const firstRead = computed(() => isLoading() && value() === undefined);
  const destroyRef = inject(DestroyRef);
  let again = false;
  let retry: ReturnType<typeof setTimeout> | undefined;

  const failed = (failure: unknown) => {
    if (destroyRef.destroyed) return;
    if (failure instanceof HttpErrorResponse && failure.status === 404) {
      gone.set(true);
      return;
    }
    if (value() === undefined) error.set(failure);
    retry = setTimeout(() => void read(), RETRY_AFTER);
  };
  const readOnce = async () => {
    clearTimeout(retry);
    isLoading.set(true);
    try {
      value.set(reuse(value(), await load()));
      error.set(undefined);
      gone.set(false);
    } catch (failure) {
      failed(failure);
    } finally {
      isLoading.set(false);
    }
  };
  // One read at a time: events during a read make one more after it.
  const read = async () => {
    if (destroyRef.destroyed) return;
    if (isLoading()) {
      again = true;
      return;
    }
    do {
      again = false;
      await readOnce();
    } while (again && !destroyRef.destroyed);
  };

  inject(Live)
    .on(kinds)
    .pipe(
      filter((m) => m.id === id()),
      debounceTime(300),
      takeUntilDestroyed(destroyRef),
    )
    .subscribe(() => void read());
  inject(Live)
    .resync.pipe(takeUntilDestroyed(destroyRef))
    .subscribe(() => void read());
  destroyRef.onDestroy(() => clearTimeout(retry));
  void read();
  return {
    error: error.asReadonly(),
    gone: gone.asReadonly(),
    isLoading: firstRead,
    reload: () => void read(),
    value: value.asReadonly(),
  };
}
