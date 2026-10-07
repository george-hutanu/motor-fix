import { isPlatformBrowser } from '@angular/common';
import {
  DestroyRef,
  effect,
  Injectable,
  inject,
  type OnDestroy,
  PLATFORM_ID,
  signal,
  untracked,
} from '@angular/core';
import type { EventKind, LiveMessage } from '@motor-fix/contracts';
import { filter, type Observable, Subject } from 'rxjs';

import { backoffDelay, readEvents, SILENT_FOR } from '../live/stream';
import { type LiveView, liveView } from '../live/view';

// What an open public view shows: a garage's page, a mechanic's, or the
// results for a brand.
export interface PublicView {
  garage?: string | undefined;
  mechanic?: string | undefined;
  brand?: string | undefined;
}

export type PublicLiveState = 'closed' | 'reconnecting' | 'open';

const ASLEEP_FOR = 60_000;

const PARAMS = [
  ['garages', 'garage'],
  ['mechanics', 'mechanic'],
  ['brand', 'brand'],
] as const;

// A visitor's one live stream, open while a public view is. It sends no token
// and needs no session; it names what the open views show, the newest view
// winning where two name a garage, and re-opens only when that changes.
@Injectable({ providedIn: 'root' })
export class PublicLive implements OnDestroy {
  private readonly browser = isPlatformBrowser(inject(PLATFORM_ID));
  private readonly messages = new Subject<LiveMessage>();
  readonly events = this.messages.asObservable();
  private readonly resyncs = new Subject<void>();
  // Every view re-reads its data on each open: the stream may have missed events.
  readonly resync: Observable<void> = this.resyncs.asObservable();
  private readonly status = signal<PublicLiveState>('closed');
  readonly state = this.status.asReadonly();

  private views: PublicView[] = [];
  private pending = false;
  private query = '';
  private wanted: AbortController | null = null;
  private hiddenAt: number | null = null;

  // A tab that slept may hold a stream that died without a word; open anew.
  private readonly onVisibility = () => {
    if (document.visibilityState === 'hidden') {
      this.hiddenAt ??= Date.now();
      return;
    }
    const slept =
      this.hiddenAt !== null && Date.now() - this.hiddenAt >= ASLEEP_FOR;
    this.hiddenAt = null;
    if (slept && this.query) this.connect();
  };

  constructor() {
    if (this.browser)
      document.addEventListener('visibilitychange', this.onVisibility);
  }

  ngOnDestroy() {
    this.wanted?.abort();
    if (this.browser)
      document.removeEventListener('visibilitychange', this.onVisibility);
  }

  // Answers the call that takes the view away again.
  register(view: PublicView): () => void {
    if (!this.browser) return () => undefined;
    const entry = { ...view };
    this.views.push(entry);
    this.schedule();
    return () => {
      const at = this.views.indexOf(entry);
      if (at < 0) return;
      this.views.splice(at, 1);
      this.schedule();
    };
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

  // Views opened and closed in the same tick make one change of stream.
  private schedule() {
    if (this.pending) return;
    this.pending = true;
    void Promise.resolve().then(() => {
      this.pending = false;
      this.apply();
    });
  }

  private apply() {
    const params = new URLSearchParams();
    for (const [param, field] of PARAMS) {
      const value = this.views.findLast((v) => v[field])?.[field];
      if (value) params.set(param, value);
    }
    const query = params.toString();
    if (query === this.query) return;
    this.query = query;
    if (query) {
      this.connect();
      return;
    }
    this.wanted?.abort();
    this.wanted = null;
    this.status.set('closed');
  }

  // Drops the stream there is, if any, and opens one for the current query.
  private connect() {
    this.wanted?.abort();
    const wanted = new AbortController();
    this.wanted = wanted;
    void this.run(`/api/v1/live/public?${this.query}`, wanted.signal);
  }

  // Tries and waits until the views change or go away.
  private async run(url: string, wanted: AbortSignal) {
    this.status.set('reconnecting');
    let failures = 0;
    for (;;) {
      await this.stream(url, wanted, () => {
        failures = 0;
        this.status.set('open');
        this.resyncs.next();
      }).catch(() => undefined);
      if (wanted.aborted) return;
      this.status.set('reconnecting');
      failures++;
      await new Promise<void>((resolve) => {
        const timer = setTimeout(done, backoffDelay(failures));
        function done() {
          clearTimeout(timer);
          wanted.removeEventListener('abort', done);
          resolve();
        }
        wanted.addEventListener('abort', done);
      });
      if (wanted.aborted) return;
    }
  }

  private async stream(url: string, wanted: AbortSignal, onOpen: () => void) {
    const attempt = new AbortController();
    const stop = () => attempt.abort();
    wanted.addEventListener('abort', stop);
    let silence: ReturnType<typeof setTimeout> | undefined;
    const heard = () => {
      clearTimeout(silence);
      silence = setTimeout(() => attempt.abort('silent'), SILENT_FOR);
    };
    // The same minute bounds a request whose answer never comes.
    heard();
    try {
      const res = await fetch(url, {
        headers: { Accept: 'text/event-stream', 'ngsw-bypass': 'true' },
        signal: attempt.signal,
      });
      // An answer that comes after the abort is not a stream.
      if (attempt.signal.aborted || !res.ok || !res.body) {
        void res.body?.cancel().catch(() => undefined);
        return;
      }
      const reader = res.body.getReader();
      attempt.signal.addEventListener(
        'abort',
        () => void reader.cancel().catch(() => undefined),
      );
      onOpen();
      heard();
      await readEvents(reader, attempt.signal, heard, (m) =>
        this.messages.next(m),
      );
    } finally {
      clearTimeout(silence);
      wanted.removeEventListener('abort', stop);
    }
  }
}

const sameView = (a: PublicView, b: PublicView) =>
  PARAMS.every(([, field]) => a[field] === b[field]);

// A public view's data, read through the API at once, again on each open of
// the stream, and again when an event of these kinds arrives about the object
// it shows (without `id`, about any object). A re-read that fails keeps the
// data and waits for the next event; a 404 or 410 marks the view gone. Call it
// in an injection context; the stream names what `view` answers, and follows it.
export function publicLiveResource<T>(
  load: () => Promise<T>,
  kinds: readonly EventKind[],
  view: () => PublicView,
  id?: () => string,
): LiveView<T> {
  const live = inject(PublicLive);
  let shown = untracked(view);
  let leave = live.register(shown);
  effect(() => {
    const next = view();
    if (sameView(next, shown)) return;
    shown = next;
    leave();
    leave = live.register(next);
  });
  inject(DestroyRef).onDestroy(() => leave());
  return liveView(load, {
    changes: live.on(kinds).pipe(filter((m) => !id || m.id === id())),
    goneOn: [404, 410],
    resync: live.resync,
  });
}
