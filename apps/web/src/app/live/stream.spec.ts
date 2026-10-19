import {
  TextDecoder as NodeDecoder,
  TextEncoder as NodeEncoder,
} from 'node:util';

import type { LiveMessage } from '@motor-fix/contracts';

import { readEvents } from './stream';

// jsdom has neither; the browser and Node both do.
globalThis.TextEncoder ??= NodeEncoder as typeof TextEncoder;
globalThis.TextDecoder ??= NodeDecoder as unknown as typeof TextDecoder;

// A reader that hands out these chunks, then ends.
function reader(chunks: string[]) {
  const queue = [...chunks];
  return {
    cancel: async () => undefined,
    read: async () => {
      const text = queue.shift();
      return text === undefined
        ? { done: true as const, value: undefined }
        : { done: false as const, value: new TextEncoder().encode(text) };
    },
    releaseLock: () => undefined,
  } as unknown as ReadableStreamDefaultReader<Uint8Array>;
}

const data = (kind: string, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ at: '2026-10-19T12:00:00.000Z', id: 'n-1', kind, ...extra });

async function read(chunks: string[]) {
  const seen: { message: LiveMessage; id: string | undefined }[] = [];
  const retries: number[] = [];
  const reason = await readEvents(
    reader(chunks),
    new AbortController().signal,
    () => undefined,
    (message, id) => seen.push({ id, message }),
    (ms) => retries.push(ms),
  );
  return { reason, retries, seen };
}

// @traces 1190-FR-008
describe('reading the live stream', () => {
  it('passes on the id line of a message with it', async () => {
    const { seen } = await read([
      `id: 42\nevent: notification.created\ndata: ${data('notification.created', { unreadCount: 3 })}\n\n`,
      `event: live.test\ndata: ${data('live.test')}\n\n`,
    ]);

    expect(seen).toEqual([
      {
        id: '42',
        message: {
          at: '2026-10-19T12:00:00.000Z',
          id: 'n-1',
          kind: 'notification.created',
          unreadCount: 3,
        },
      },
      {
        id: undefined,
        message: {
          at: '2026-10-19T12:00:00.000Z',
          id: 'n-1',
          kind: 'live.test',
        },
      },
    ]);
  });

  it('takes an id line split across two chunks whole', async () => {
    const whole = `id: 4812\nevent: notification.created\ndata: ${data('notification.created')}\n\n`;

    const { seen } = await read([whole.slice(0, 6), whole.slice(6)]);

    expect(seen.map((s) => s.id)).toEqual(['4812']);
  });

  it('ignores an id line that is not a position', async () => {
    const { seen } = await read([
      `id: nope\nevent: notification.created\ndata: ${data('notification.created')}\n\n`,
    ]);

    expect(seen.map((s) => s.id)).toEqual([undefined]);
  });
});

// @traces 1190-FR-006
describe('the limits the server sets', () => {
  it('reports the retry the server asks for', async () => {
    const { retries, seen } = await read([
      'retry: 3000\n\n',
      `event: hello\ndata: ${data('hello')}\n\n`,
    ]);

    expect(retries).toEqual([3000]);
    expect(seen.map((s) => s.message.kind)).toEqual(['hello']);
  });

  it('ignores a retry that is not a number of milliseconds', async () => {
    const { retries } = await read(['retry: soon\n\n', 'retry: -5\n\n']);

    expect(retries).toEqual([]);
  });

  it('answers reconnect when the server ends with a planned reconnect', async () => {
    const { reason, seen } = await read([
      `event: reconnect\ndata: ${data('reconnect')}\n\n`,
    ]);

    expect(reason).toBe('reconnect');
    expect(seen.map((s) => s.message.kind)).toEqual(['reconnect']);
  });

  it('still answers the reason of a bye', async () => {
    const { reason } = await read([
      `event: bye\ndata: ${data('bye', { reason: 'expired' })}\n\n`,
    ]);

    expect(reason).toBe('expired');
  });
});
