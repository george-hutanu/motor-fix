import { randomUUID } from 'node:crypto';

import type { LiveByeReason, LiveMessage } from '@motor-fix/contracts';
import { Logger } from '@nestjs/common';

export const LIVE_CHANNEL = 'live:events';

const HEARTBEAT_MS = 25_000;
const STREAMS_PER_ACCOUNT = 10;

// An Express response, as far as the hub needs one.
interface LiveSink {
  readonly destroyed?: boolean;
  write(chunk: string): unknown;
  end(): unknown;
  on(event: 'close', listener: () => void): unknown;
}

interface LiveTarget {
  accountId: string;
  channels: string[];
  expiresAt: number;
}

interface Connection {
  id: string;
  accountId: string;
  channels: Set<string>;
  sink: LiveSink;
  heartbeat?: NodeJS.Timeout;
  expiry?: NodeJS.Timeout;
}

// The kind becomes the SSE `event:` line, so it may hold no line break.
const KIND = /^[\w.-]{1,64}$/;

const isEvent = (value: unknown): value is LiveMessage => {
  const v = value as Partial<LiveMessage> | null;
  return (
    typeof v === 'object' &&
    v !== null &&
    typeof v.kind === 'string' &&
    KIND.test(v.kind) &&
    typeof v.id === 'string' &&
    typeof v.at === 'string'
  );
};

const frame = (message: LiveMessage) =>
  `event: ${message.kind}\ndata: ${JSON.stringify(message)}\n\n`;

// The open streams of one API copy. Every copy subscribes to the one Redis
// channel and writes an event only to its own streams in the event's audience.
export class LiveHub {
  private readonly logger = new Logger('Live');
  private readonly connections = new Map<string, Connection>();

  constructor(
    private readonly redis: {
      publish(channel: string, message: string): Promise<unknown>;
    },
  ) {}

  open(sink: LiveSink, target: LiveTarget): string | null {
    // A client that left before the stream opened has already emitted close.
    if (sink.destroyed) return null;
    const connection: Connection = {
      accountId: target.accountId,
      channels: new Set(target.channels),
      id: randomUUID(),
      sink,
    };
    this.connections.set(connection.id, connection);
    sink.on('close', () => this.release(connection));
    this.send(connection, this.control('hello', connection));
    connection.expiry = setTimeout(
      () => this.bye(connection, 'expired'),
      Math.max(0, target.expiresAt - Date.now()),
    );
    const own = [...this.connections.values()].filter(
      (c) => c.accountId === target.accountId,
    );
    const oldest = own[0];
    if (own.length > STREAMS_PER_ACCOUNT && oldest) this.bye(oldest, 'evicted');
    return connection.id;
  }

  deliver(raw: string) {
    let message: { event?: unknown; audience?: unknown };
    try {
      message = JSON.parse(raw);
    } catch {
      this.logger.warn('dropped a live message that is not JSON');
      return;
    }
    const { audience, event } = message ?? {};
    if (!Array.isArray(audience) || !isEvent(event)) {
      this.logger.warn('dropped a live message without an event or audience');
      return;
    }
    // Only the three fields go out, whatever else the publisher put in.
    const { at, id, kind } = event;
    for (const connection of this.connections.values()) {
      if (audience.some((key) => connection.channels.has(key))) {
        this.send(connection, { at, id, kind });
      }
    }
  }

  async publish(event: LiveMessage, audience: string[]) {
    await this.redis.publish(LIVE_CHANNEL, JSON.stringify({ audience, event }));
  }

  shutdown() {
    for (const connection of [...this.connections.values()]) {
      this.bye(connection, 'shutdown');
    }
  }

  private control(kind: 'hello' | 'bye', connection: Connection) {
    return { at: new Date().toISOString(), id: connection.id, kind };
  }

  private send(connection: Connection, message: LiveMessage) {
    this.write(connection, frame(message));
  }

  private write(connection: Connection, chunk: string) {
    try {
      connection.sink.write(chunk);
    } catch {
      // A socket that broke under us: the stream is over.
      this.release(connection);
      return;
    }
    clearTimeout(connection.heartbeat);
    connection.heartbeat = setTimeout(
      () => this.write(connection, ': ping\n\n'),
      HEARTBEAT_MS,
    );
  }

  private bye(connection: Connection, reason: LiveByeReason) {
    this.send(connection, { ...this.control('bye', connection), reason });
    this.release(connection);
    connection.sink.end();
  }

  private release(connection: Connection) {
    clearTimeout(connection.heartbeat);
    clearTimeout(connection.expiry);
    this.connections.delete(connection.id);
  }
}
