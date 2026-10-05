import { isPlatformBrowser } from '@angular/common';
import {
  DestroyRef,
  Injectable,
  inject,
  PLATFORM_ID,
  type ResourceRef,
  resource,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import type {
  EventKind,
  LiveByeReason,
  LiveMessage,
} from '@motor-fix/contracts';
import { debounceTime, filter, type Observable, Subject } from 'rxjs';

import { Session } from './session';

const RECONNECT_AFTER: readonly LiveByeReason[] = ['expired', 'shutdown'];

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
export class Live {
  private readonly session = inject(Session);
  private readonly browser = isPlatformBrowser(inject(PLATFORM_ID));
  private readonly messages = new Subject<LiveMessage>();
  readonly events = this.messages.asObservable();
  private current: AbortController | null = null;

  open() {
    if (!this.browser || this.current) return;
    const abort = new AbortController();
    this.current = abort;
    void this.run(abort);
  }

  close() {
    this.current?.abort();
    this.current = null;
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

  // One renew-and-reconnect after the server says it ended the stream for a
  // reason a fresh connection fixes; backoff and catch-up are not built here.
  private async run(abort: AbortController) {
    const reason = await this.read(abort.signal).catch(() => null);
    const again =
      reason !== null &&
      RECONNECT_AFTER.includes(reason) &&
      !abort.signal.aborted &&
      (await this.session.renew().catch(() => false));
    if (this.current !== abort) return;
    this.current = null;
    if (again && !abort.signal.aborted) this.open();
  }

  private async read(signal: AbortSignal): Promise<LiveByeReason | null> {
    const token = this.session.token();
    if (!token) return null;
    const res = await fetch('/api/v1/live', {
      headers: {
        Accept: 'text/event-stream',
        Authorization: `Bearer ${token}`,
        'ngsw-bypass': 'true',
      },
      signal,
    });
    if (!res.ok || !res.body) return null;
    const reader = res.body.getReader();
    signal.addEventListener(
      'abort',
      () => void reader.cancel().catch(() => undefined),
    );
    return this.consume(reader, signal);
  }

  // Server-sent events arrive in blocks that end with a blank line; a chunk
  // may end in the middle of one. The loop ends when the server closes the
  // stream or close() cancels the reader.
  private async consume(
    reader: ReadableStreamDefaultReader<Uint8Array>,
    signal: AbortSignal,
  ) {
    const decoder = new TextDecoder();
    let buffer = '';
    let reason: LiveByeReason | null = null;
    for (;;) {
      const { done, value } = await reader.read();
      if (done || signal.aborted) return reason;
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

// A view's data, read through the API and read again when an event of these
// kinds arrives about the object it shows; a burst of 300 ms is one re-read.
// Call it in an injection context.
export function liveResource<T>(
  load: () => Promise<T>,
  kinds: readonly EventKind[],
  id: () => string,
): ResourceRef<T | undefined> {
  const ref = resource({ loader: load });
  inject(Live)
    .on(kinds)
    .pipe(
      filter((m) => m.id === id()),
      debounceTime(300),
      takeUntilDestroyed(inject(DestroyRef)),
    )
    .subscribe(() => ref.reload());
  return ref;
}
