import { randomUUID } from 'node:crypto';

import type { LiveByeReason, LiveMessage } from '@motor-fix/contracts';
import { Logger } from '@nestjs/common';

import type { GarageAccess, LoadGarageAccess } from './garage-access';
import type { Permissions, Role } from '../auth/capabilities';

export const LIVE_CHANNEL = 'live:events';

const HEARTBEAT_MS = 25_000;
const STREAMS_PER_ACCOUNT = 10;
const ACCESS_MS = 60_000;

// Kinds about a request, job or car: never sent through a public key.
const PRIVATE = /^(request|quote|booking|job|media|live|message|car|repair)\./;
// Prices, settings, feature switches and the team: not for a receptionist.
const HIDDEN_FROM_RECEPTIONIST =
  /^(price_list\.|member\.|mechanic\.|garage\.settings_changed$|garage\.features_changed$)/;
// What reaches a mechanic through the garage, by the right it needs. Their own
// jobs and bookings come through their mechanic channel.
const MECHANIC_RIGHTS: [RegExp, keyof Permissions][] = [
  [/^(request|message)\./, 'canAnswerQuotes'],
  [/^booking\.move/, 'canMoveBookings'],
];
const FEATURES: [RegExp, string][] = [[/^media\./, 'live_media']];
const REREAD_ACCESS = new Set([
  'member.removed',
  'mechanic.updated',
  'garage.features_changed',
]);
const ENDS_ACCOUNT = new Set(['account.suspended', 'account.deleted']);

const isStaffKey = (key: string) =>
  key.startsWith('garage:') || key.startsWith('mechanic:');

const leaveGarage = (connection: Connection) => {
  for (const channel of connection.channels) {
    if (isStaffKey(channel)) connection.channels.delete(channel);
  }
};

// Whether a staff stream that met an event only on its garage or mechanic
// channel may have it: still staff in its role, and the role, rights and the
// garage's switches allow the kind.
function allows(
  access: GarageAccess,
  { accountId, role }: Pick<Connection, 'accountId' | 'role'>,
  kind: string,
  keys: string[],
) {
  if (FEATURES.some(([kinds, key]) => kinds.test(kind) && access.off.has(key)))
    return false;
  if (role === 'garage') return access.owners.has(accountId);
  if (role === 'receptionist') {
    return (
      access.receptionists.has(accountId) &&
      !HIDDEN_FROM_RECEPTIONIST.test(kind)
    );
  }
  const rights = role === 'mechanic' ? access.mechanics.get(accountId) : null;
  if (!rights) return false;
  if (keys.some((key) => key.startsWith('mechanic:'))) return true;
  return MECHANIC_RIGHTS.some(
    ([kinds, right]) => kinds.test(kind) && rights[right],
  );
}

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
  role: Role;
  garageId: string | null;
}

interface Connection {
  id: string;
  accountId: string;
  role: Role;
  garageId: string | null;
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

// What every API copy's subscriber reads off the one channel. Anything that
// can publish to Redis may send it; the hub needs no part in that.
export interface LivePublisher {
  publish(channel: string, message: string): Promise<unknown>;
}

export const publishLive = (
  redis: LivePublisher,
  event: LiveMessage,
  audience: string[],
) => redis.publish(LIVE_CHANNEL, JSON.stringify({ audience, event }));

const frame = (message: LiveMessage) =>
  `event: ${message.kind}\ndata: ${JSON.stringify(message)}\n\n`;

// The open streams of one API copy. Every copy subscribes to the one Redis
// channel and writes an event only to its own streams in the event's audience.
export class LiveHub {
  private readonly logger = new Logger('Live');
  private readonly connections = new Map<string, Connection>();
  private readonly access = new Map<
    string,
    { until: number; access: Promise<GarageAccess> }
  >();

  constructor(private readonly loadAccess: LoadGarageAccess) {}

  open(sink: LiveSink, target: LiveTarget): string | null {
    // A client that left before the stream opened has already emitted close.
    if (sink.destroyed) return null;
    const connection: Connection = {
      accountId: target.accountId,
      channels: new Set(target.channels),
      garageId: target.garageId,
      id: randomUUID(),
      role: target.role,
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

  async deliver(raw: string) {
    const message = this.read(raw);
    if (!message) return;
    const { event, keys } = message;
    // Only the three fields go out, whatever else the publisher put in.
    const { at, id, kind } = event;
    this.follow(kind, id, keys);
    const open = PRIVATE.test(kind)
      ? keys.filter((key) => !key.startsWith('public:'))
      : keys;
    const staff: Promise<void>[] = [];
    for (const connection of this.connections.values()) {
      const met = open.filter((key) => connection.channels.has(key));
      if (met.length === 0) continue;
      if (met.some((key) => !isStaffKey(key))) {
        this.send(connection, { at, id, kind });
      } else {
        staff.push(this.sendToStaff(connection, { at, id, kind }, met));
      }
    }
    await Promise.all(staff);
  }

  shutdown() {
    for (const connection of [...this.connections.values()]) {
      this.bye(connection, 'shutdown');
    }
  }

  private read(raw: string) {
    let message: { event?: unknown; audience?: unknown };
    try {
      message = JSON.parse(raw);
    } catch {
      this.logger.warn('dropped a live message that is not JSON');
      return null;
    }
    const { audience, event } = message ?? {};
    if (!Array.isArray(audience) || !isEvent(event)) {
      this.logger.warn('dropped a live message without an event or audience');
      return null;
    }
    const keys = audience.filter((k): k is string => typeof k === 'string');
    if (keys.length === 0) {
      this.logger.warn(`dropped ${event.kind}: it has no audience`);
      return null;
    }
    return { event, keys };
  }

  // What an event changes about the streams themselves, before it goes out.
  private follow(kind: string, id: string, keys: string[]) {
    const rereads = REREAD_ACCESS.has(kind);
    if (!rereads && !ENDS_ACCOUNT.has(kind)) return;
    const garages = keys
      .filter((key) => key.startsWith('garage:'))
      .map((key) => key.slice('garage:'.length));
    if (rereads) {
      for (const garageId of garages) this.access.delete(garageId);
    }
    const own = [...this.connections.values()].filter(
      (c) => c.accountId === id,
    );
    if (ENDS_ACCOUNT.has(kind)) {
      for (const connection of own) this.bye(connection, 'evicted');
    }
    if (kind === 'member.removed') {
      own
        .filter((c) => garages.includes(c.garageId ?? ''))
        .forEach(leaveGarage);
    }
  }

  private async sendToStaff(
    connection: Connection,
    message: LiveMessage,
    keys: string[],
  ) {
    if (!connection.garageId) return;
    let access: GarageAccess;
    try {
      access = await this.accessOf(connection.garageId);
    } catch (error) {
      this.logger.warn(
        `dropped ${message.kind} for a stream of garage ${connection.garageId}: ${(error as Error).message}`,
      );
      return;
    }
    // The stream may have closed, or left the garage, while the read ran.
    const still = keys.filter((key) => connection.channels.has(key));
    if (!this.connections.has(connection.id) || still.length === 0) return;
    if (allows(access, connection, message.kind, still)) {
      this.send(connection, message);
    }
  }

  private accessOf(garageId: string) {
    const cached = this.access.get(garageId);
    if (cached && cached.until > Date.now()) return cached.access;
    const entry = {
      access: this.loadAccess(garageId),
      until: Date.now() + ACCESS_MS,
    };
    this.access.set(garageId, entry);
    // A failed read is not kept: the next event reads again.
    entry.access.catch(() => {
      if (this.access.get(garageId) === entry) this.access.delete(garageId);
    });
    return entry.access;
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
