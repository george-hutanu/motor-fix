import { randomUUID } from 'node:crypto';

import type { LiveByeReason, LiveMessage } from '@motor-fix/contracts';
import { Logger } from '@nestjs/common';

import { countReplay, countStreamClose } from './live.metrics';
import { type LoadReplay, REPLAY_LIMIT, type ReplayRow } from './live.replay';
import {
  type Capability,
  capabilitiesOf,
  type Permissions,
  type Role,
} from '../../auth/capabilities';
import type { GarageAccess, LoadGarageAccess } from '../garage-access';

export const LIVE_CHANNEL = 'live:events';

// What a stream opens with: no-transform keeps an edge from compressing
// (and so holding) the events, X-Accel-Buffering keeps a proxy from buffering.
export const LIVE_HEADERS = {
  'Cache-Control': 'no-cache, no-transform',
  'Content-Type': 'text/event-stream; charset=utf-8',
  'X-Accel-Buffering': 'no',
};

const HEARTBEAT_MS = 25_000;
const STREAMS_PER_ACCOUNT = 10;
const PUBLIC_STREAMS_PER_ADDRESS = 20;
const ACCESS_MS = 60_000;
// What a signed-in client waits before it reconnects after a drop.
const RETRY_MS = 3000;
// A stream ends itself a minute before the platform's 15-minute limit would
// cut it; the client reopens at once from its last position.
export const RECONNECT_AFTER_MS = 14 * 60_000;
// The id line of a frame, and the position a client sends back.
const POSITION = /^\d{1,18}$/;
// The two kinds that carry the account's unread count.
const COUNTED = new Set(['notification.created', 'notification.read']);

// Kinds about a request, job or car: never sent through a public key.
const PRIVATE = /^(request|quote|booking|job|media|live|message|car|repair)\./;
// The capability a garage's staff need to hear a kind through the garage
// channel; who holds which is capabilitiesOf's to say. A kind no family claims
// reaches an owner and a receptionist, and never a mechanic, whose own jobs and
// bookings come through their mechanic channel.
export const KIND_CAPABILITY: [RegExp, Capability][] = [
  [/^(price_list|catalogue_job)\./, 'garage.prices'],
  [/^(member|mechanic|invite)\./, 'garage.team'],
  [/^garage\.(settings_changed|features_changed)$/, 'garage.feature_switches'],
  [/^garage\.updated$/, 'garage.profile'],
  [/^review\./, 'garage.reviews'],
  [/^(request|message)\./, 'garage.requests'],
  [/^booking\.move/, 'garage.schedule'],
];
const FEATURES: [RegExp, string][] = [[/^media\./, 'live_media']];
const REREAD_ACCESS = new Set([
  'member.removed',
  'mechanic.updated',
  'garage.features_changed',
]);
const ENDS_ACCOUNT = new Set(['account.suspended', 'account.deleted']);

const REVIEW_KINDS = [
  'review.posted',
  'review.edited',
  'review.deleted',
  'review.replied',
  'review.reply_edited',
  'review.reported',
  'review.decided',
  'review.appeal_decided',
];
// What a visitor's stream may hear through each key it joined; anything else
// stays with the signed-in streams.
const PUBLIC_KINDS: [RegExp, Set<string>][] = [
  [
    /^public:garage:/,
    new Set([
      'garage.updated',
      'price_list.updated',
      'mechanic.updated',
      'facility.removed',
      'facility.re_add_decided',
      ...REVIEW_KINDS,
      'garage.suspended',
      'garage.restored',
      'garage.slots_changed',
      'response_stats.updated',
      'recheck.recorded',
    ]),
  ],
  [/^public:mechanic:/, new Set(['mechanic.updated', ...REVIEW_KINDS])],
  [
    /^public:search$/,
    new Set([
      'verification.decided',
      'garage.suspended',
      'garage.restored',
      'garage.updated',
    ]),
  ],
  [/^public:search:/, new Set(['garage.updated'])],
  [
    /^system$/,
    new Set([
      'platform_rule.changed',
      'platform_rule.change_requested',
      'platform_rule.change_decided',
    ]),
  ],
];

const publicAllows = (key: string, kind: string) =>
  PUBLIC_KINDS.find(([keys]) => keys.test(key))?.[1].has(kind) ?? false;

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
  const rights = staffRights(access, role, accountId);
  if (!rights) return false;
  if (role === 'mechanic' && keys.some((key) => key.startsWith('mechanic:')))
    return true;
  const needs = KIND_CAPABILITY.find(([kinds]) => kinds.test(kind))?.[1];
  if (!needs) return role !== 'mechanic';
  return capabilitiesOf(role, rights).includes(needs);
}

const NO_RIGHTS: Permissions = {
  canAnswerQuotes: false,
  canMoveBookings: false,
  canRecordFinalPrice: false,
};

// A connection's rights in the garage while it is still staff in its role.
function staffRights(
  access: GarageAccess,
  role: Role,
  accountId: string,
): Permissions | null {
  if (role === 'mechanic') return access.mechanics.get(accountId) ?? null;
  if (role === 'garage') return access.owners.has(accountId) ? NO_RIGHTS : null;
  if (role === 'receptionist')
    return access.receptionists.has(accountId) ? NO_RIGHTS : null;
  return null;
}

// An Express response, as far as the hub needs one.
interface LiveSink {
  readonly destroyed?: boolean;
  write(chunk: string): unknown;
  end(): unknown;
  on(event: 'close', listener: () => void): unknown;
}

type LiveTarget =
  | {
      accountId: string;
      channels: string[];
      expiresAt: number;
      role: Role;
      garageId: string | null;
      // The last position the client has; null or absent replays nothing.
      since?: bigint | null;
    }
  // A visitor's stream: no account, no expiry, counted against its address.
  | { public: true; address: string | null; channels: string[] };

interface Connection {
  id: string;
  accountId: string;
  role: Role;
  garageId: string | null;
  channels: Set<string>;
  sink: LiveSink;
  // Set on a visitor's stream only; null when the address could not be read.
  address?: string | null;
  heartbeat?: NodeJS.Timeout;
  expiry?: NodeJS.Timeout;
  planned?: NodeJS.Timeout;
  // Live events that came while the replay was read, sent once it is written.
  held?: Outgoing[] | null;
  // No notification.created at or below this is sent again on this stream.
  replayedTo?: bigint;
}

// A message on its way out, with its position when it has one.
interface Outgoing {
  message: LiveMessage;
  position?: string;
}

const isPublic = (connection: Connection) => connection.address !== undefined;

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

// A notification.created goes with its row's position, the stream's cursor.
export const publishLive = (
  redis: LivePublisher,
  event: LiveMessage,
  audience: string[],
  position?: bigint,
) =>
  redis.publish(
    LIVE_CHANNEL,
    JSON.stringify({
      audience,
      event,
      ...(position !== undefined && { position: String(position) }),
    }),
  );

// Only a notification.created carries an id line: it is what a returning
// stream asks to be replayed after.
const frame = ({ message, position }: Outgoing) =>
  `${position !== undefined && message.kind === 'notification.created' ? `id: ${position}\n` : ''}event: ${message.kind}\ndata: ${JSON.stringify(message)}\n\n`;

// Only the fields a client may read go out, whatever else the publisher put in.
function outgoing(event: LiveMessage, position: unknown): Outgoing {
  const { at, id, kind, unreadCount } = event;
  const message: LiveMessage = { at, id, kind };
  if (
    COUNTED.has(kind) &&
    typeof unreadCount === 'number' &&
    Number.isInteger(unreadCount) &&
    unreadCount >= 0
  )
    message.unreadCount = unreadCount;
  return typeof position === 'string' && POSITION.test(position)
    ? { message, position }
    : { message };
}

interface LiveHubOptions {
  // Unset, a stream lives until its token expires.
  reconnectAfterMs?: number;
  // Unset, a returning stream is not replayed to.
  replay?: LoadReplay;
}

// The open streams of one API copy. Every copy subscribes to the one Redis
// channel and writes an event only to its own streams in the event's audience.
export class LiveHub {
  private readonly logger = new Logger('Live');
  private readonly connections = new Map<string, Connection>();
  private readonly access = new Map<
    string,
    { until: number; access: Promise<GarageAccess> }
  >();

  constructor(
    private readonly loadAccess: LoadGarageAccess,
    private readonly options: LiveHubOptions = {},
  ) {}

  // Whether one more visitor stream may open from this address on this copy.
  publicPlace(address: string | null) {
    if (address === null) {
      this.logger.warn('opened a public stream without a client address');
      return true;
    }
    let open = 0;
    for (const connection of this.connections.values()) {
      if (connection.address === address) open++;
    }
    return open < PUBLIC_STREAMS_PER_ADDRESS;
  }

  open(sink: LiveSink, target: LiveTarget): string | null {
    // A client that left before the stream opened has already emitted close.
    if (sink.destroyed) return null;
    if ('public' in target) {
      const connection: Connection = {
        accountId: '',
        address: target.address,
        channels: new Set(target.channels),
        garageId: null,
        id: randomUUID(),
        role: 'driver',
        sink,
      };
      this.connections.set(connection.id, connection);
      sink.on('close', () => this.release(connection));
      this.send(connection, this.control('hello', connection));
      return connection.id;
    }
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
    this.write(connection, `retry: ${RETRY_MS}\n\n`);
    this.send(connection, this.control('hello', connection));
    connection.expiry = setTimeout(
      () => this.bye(connection, 'expired'),
      Math.max(0, target.expiresAt - Date.now()),
    );
    const { reconnectAfterMs, replay } = this.options;
    if (reconnectAfterMs !== undefined) {
      connection.planned = setTimeout(
        () => this.end(connection),
        reconnectAfterMs,
      );
    }
    // Only what the replay wrote arms the drop rule: a position that is not
    // the account's replays nothing and must not hide what comes live.
    if (target.since !== null && target.since !== undefined && replay) {
      connection.held = [];
      void this.replay(connection, replay, target.since);
    }
    const own = [...this.connections.values()].filter(
      (c) => !isPublic(c) && c.accountId === target.accountId,
    );
    const oldest = own[0];
    if (own.length > STREAMS_PER_ACCOUNT && oldest) this.bye(oldest, 'evicted');
    return connection.id;
  }

  async deliver(raw: string) {
    const message = this.read(raw);
    if (!message) return;
    const { event, keys } = message;
    const out = outgoing(event, message.position);
    const { id, kind } = out.message;
    this.follow(kind, id, keys);
    const open = PRIVATE.test(kind)
      ? keys.filter((key) => !key.startsWith('public:'))
      : keys;
    const staff: Promise<void>[] = [];
    for (const connection of this.connections.values()) {
      const met = open.filter((key) => connection.channels.has(key));
      if (met.length === 0) continue;
      if (isPublic(connection)) {
        this.sendToPublic(connection, out.message, met);
      } else if (met.some((key) => !isStaffKey(key))) {
        this.post(connection, out);
      } else {
        staff.push(this.sendToStaff(connection, out, met));
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
    let message: { event?: unknown; audience?: unknown; position?: unknown };
    try {
      message = JSON.parse(raw);
    } catch {
      this.logger.warn('dropped a live message that is not JSON');
      return null;
    }
    const { audience, event, position } = message ?? {};
    if (!Array.isArray(audience) || !isEvent(event)) {
      this.logger.warn('dropped a live message without an event or audience');
      return null;
    }
    const keys = audience.filter((k): k is string => typeof k === 'string');
    if (keys.length === 0) {
      this.logger.warn(`dropped ${event.kind}: it has no audience`);
      return null;
    }
    return { event, keys, position };
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
      (c) => !isPublic(c) && c.accountId === id,
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

  private sendToPublic(
    connection: Connection,
    message: LiveMessage,
    keys: string[],
  ) {
    if (keys.some((key) => publicAllows(key, message.kind)))
      this.send(connection, message);
  }

  private async sendToStaff(
    connection: Connection,
    out: Outgoing,
    keys: string[],
  ) {
    const { message } = out;
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
      this.post(connection, out);
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

  // Writes what the account missed after `since`, then what came meanwhile.
  // A read that fails leaves the bell's own reads to catch up.
  private async replay(
    connection: Connection,
    replay: LoadReplay,
    since: bigint,
  ) {
    let found: { rows: ReplayRow[]; unreadCount: number } | null = null;
    try {
      found = await replay(connection.accountId, since);
    } catch (error) {
      this.logger.warn(
        `could not replay a returning stream: ${(error as Error).message}`,
      );
    }
    const held = connection.held ?? [];
    connection.held = null;
    if (!this.connections.has(connection.id)) return;
    if (found) this.writeReplay(connection, found);
    for (const out of held) this.post(connection, out);
  }

  private writeReplay(
    connection: Connection,
    { rows, unreadCount }: { rows: ReplayRow[]; unreadCount: number },
  ) {
    for (const row of rows) {
      this.post(connection, {
        message: {
          at: row.createdAt.toISOString(),
          id: row.id,
          kind: 'notification.created',
          unreadCount,
        },
        position: String(row.position),
      });
    }
    const last = rows.at(-1);
    if (last) connection.replayedTo = last.position;
    countReplay(
      rows.length === 0
        ? 'none'
        : rows.length >= REPLAY_LIMIT
          ? 'capped'
          : 'some',
      rows.length,
    );
  }

  private control(kind: 'hello' | 'bye' | 'reconnect', connection: Connection) {
    return { at: new Date().toISOString(), id: connection.id, kind };
  }

  private send(connection: Connection, message: LiveMessage) {
    this.write(connection, frame({ message }));
  }

  // An event for a signed-in stream: held while its replay is read, and a
  // notification the replay already wrote is not written twice.
  private post(connection: Connection, out: Outgoing) {
    if (connection.held) {
      connection.held.push(out);
      return;
    }
    const { replayedTo } = connection;
    if (
      out.position !== undefined &&
      out.message.kind === 'notification.created' &&
      replayedTo !== undefined &&
      BigInt(out.position) <= replayedTo
    )
      return;
    this.write(connection, frame(out));
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
    countStreamClose(reason);
  }

  // The planned close: the client reopens at once from its last position.
  private end(connection: Connection) {
    this.send(connection, this.control('reconnect', connection));
    this.release(connection);
    connection.sink.end();
    countStreamClose('reconnect');
  }

  private release(connection: Connection) {
    clearTimeout(connection.heartbeat);
    clearTimeout(connection.expiry);
    clearTimeout(connection.planned);
    this.connections.delete(connection.id);
  }
}
