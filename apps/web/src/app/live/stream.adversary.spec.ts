import {
  TextDecoder as NodeDecoder,
  TextEncoder as NodeEncoder,
} from 'node:util';

import type { LiveMessage } from '@motor-fix/contracts';

import { readEvents } from './stream';

globalThis.TextEncoder ??= NodeEncoder as typeof TextEncoder;
globalThis.TextDecoder ??= NodeDecoder as unknown as typeof TextDecoder;

function reader(chunks: (string | Uint8Array)[]) {
  const queue = [...chunks];
  return {
    cancel: async () => undefined,
    read: async () => {
      const next = queue.shift();
      return next === undefined
        ? { done: true as const, value: undefined }
        : {
            done: false as const,
            value:
              typeof next === 'string' ? new TextEncoder().encode(next) : next,
          };
    },
    releaseLock: () => undefined,
  } as unknown as ReadableStreamDefaultReader<Uint8Array>;
}

const data = (kind: string, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ at: '2026-10-19T12:00:00.000Z', id: 'n-1', kind, ...extra });

async function read(chunks: (string | Uint8Array)[], signal?: AbortSignal) {
  const seen: { message: LiveMessage; id: string | undefined }[] = [];
  const retries: number[] = [];
  const reason = await readEvents(
    reader(chunks),
    signal ?? new AbortController().signal,
    () => undefined,
    (message, id) => seen.push({ id, message }),
    (ms) => retries.push(ms),
  );
  return { reason, retries, seen };
}

const created = (idLine: string) =>
  `${idLine}event: notification.created\ndata: ${data('notification.created')}\n\n`;

// @traces 1190-FR-008
describe('reading ids from the live stream, hostile input', () => {
  it.each([
    ['a letter', 'id: 4x2\n'],
    ['a negative number', 'id: -5\n'],
    ['a decimal', 'id: 4.5\n'],
    ['an exponent', 'id: 1e3\n'],
    ['nineteen digits', `id: ${'9'.repeat(19)}\n`],
    ['an empty value', 'id:\n'],
    ['trailing spaces', 'id: 42 \n'],
    ['a name in capitals', 'ID: 42\n'],
    ['a null byte', 'id: 4\u00002\n'],
    ['non-ASCII digits', 'id: ٤٢\n'],
  ])('passes no position for an id line with %s', async (_n, line) => {
    const { seen } = await read([created(line)]);

    expect(seen).toHaveLength(1);
    expect(seen[0]?.id).toBeUndefined();
  });

  it('keeps an eighteen digit position exactly as sent', async () => {
    const { seen } = await read([created('id: 900719925474099301\n')]);

    expect(seen[0]?.id).toBe('900719925474099301');
  });

  it('takes the last of several id lines in one block', async () => {
    const { seen } = await read([created('id: 1\nid: 2\nid: 3\n')]);

    expect(seen[0]?.id).toBe('3');
  });

  it('does not let an id line leak onto the next block', async () => {
    const { seen } = await read([
      `${created('id: 8\n')}event: live.test\ndata: ${data('live.test')}\n\n`,
    ]);

    expect(seen.map((s) => s.id)).toEqual(['8', undefined]);
  });

  it('reads an id line with no space after the colon', async () => {
    const { seen } = await read([created('id:77\n')]);

    expect(seen[0]?.id).toBe('77');
  });

  it('ignores an id inside a comment line', async () => {
    const { seen } = await read([
      `: id: 5\n${created('')}`.replace('\n\n', '\n\n'),
    ]);

    expect(seen[0]?.id).toBeUndefined();
  });

  it('emits nothing for a block whose data is not a message even when it has an id', async () => {
    const { seen } = await read([
      'id: 5\ndata: {not json\n\n',
      'id: 6\ndata: null\n\n',
      'id: 7\ndata: {"kind":1,"id":"x","at":"y"}\n\n',
      'id: 8\n\n',
    ]);

    expect(seen).toEqual([]);
  });

  it('reads an id line split across chunks and CRLF line ends split between them', async () => {
    const text = created('id: 123456\n').replace(/\n/g, '\r\n');
    const cut = text.indexOf('\r\n') + 1;

    const { seen } = await read([text.slice(0, cut), text.slice(cut)]);

    expect(seen.map((s) => s.id)).toEqual(['123456']);
  });

  it('reads a multi-byte character split between two chunks', async () => {
    const bytes = new TextEncoder().encode(
      `event: live.test\ndata: ${data('live.test', { name: 'Ștefan' })}\n\n`,
    );
    const at = bytes.indexOf(0xc8) + 1;

    const { seen } = await read([bytes.slice(0, at), bytes.slice(at)]);

    expect(seen[0]?.message).toMatchObject({ name: 'Ștefan' });
  });

  it('reads ten thousand messages in one chunk in order', async () => {
    const text = Array.from(
      { length: 10_000 },
      (_, i) =>
        `id: ${i + 1}\nevent: live.test\ndata: ${data('live.test')}\n\n`,
    ).join('');

    const { seen } = await read([text]);

    expect(seen).toHaveLength(10_000);
    expect(seen.at(-1)?.id).toBe('10000');
  });

  it('emits nothing from a chunk that arrives after the abort', async () => {
    const abort = new AbortController();
    abort.abort();

    const { seen } = await read([created('id: 1\n')], abort.signal);

    expect(seen).toEqual([]);
  });
});

// @traces 1190-FR-006
describe('reading the retry line, hostile input', () => {
  it.each([
    ['negative', 'retry: -1'],
    ['a decimal', 'retry: 3.5'],
    ['an exponent', 'retry: 1e3'],
    ['a word', 'retry: soon'],
    ['empty', 'retry:'],
    ['signed', 'retry: +3000'],
    ['in capitals', 'RETRY: 3000'],
  ])('reports no wait for a retry line that is %s', async (_n, line) => {
    const { retries } = await read([`${line}\n\n`]);

    expect(retries).toEqual([]);
  });

  it('reports the wait of a plain retry block and emits no message for it', async () => {
    const { retries, seen } = await read(['retry: 3000\n\n']);

    expect(retries).toEqual([3000]);
    expect(seen).toEqual([]);
  });

  it('reports a retry split across chunks once, whole', async () => {
    const { retries } = await read(['retr', 'y: 30', '00\n', '\n']);

    expect(retries).toEqual([3000]);
  });

  it('takes the last of two retry lines in one block', async () => {
    const { retries } = await read(['retry: 1000\nretry: 2000\n\n']);

    expect(retries).toEqual([2000]);
  });

  it('never reports a wait a timer cannot hold', async () => {
    const { retries } = await read([`retry: ${'9'.repeat(25)}\n\n`]);

    expect(retries.every((ms) => ms <= 2_147_483_647)).toBe(true);
  });

  it('works without a retry callback', async () => {
    const reason = await readEvents(
      reader(['retry: 3000\n\n']),
      new AbortController().signal,
      () => undefined,
      () => undefined,
    );

    expect(reason).toBeNull();
  });
});

// @traces 1190-FR-008
describe('the reason a stream ends, hostile input', () => {
  it('answers reconnect for a planned close and keeps reading what follows in the chunk', async () => {
    const { reason, seen } = await read([
      `event: reconnect\ndata: ${data('reconnect')}\n\nevent: live.test\ndata: ${data('live.test')}\n\n`,
    ]);

    expect(reason).toBe('reconnect');
    expect(seen.map((s) => s.message.kind)).toEqual(['reconnect', 'live.test']);
  });

  it('answers the last reason when a bye follows a reconnect', async () => {
    const { reason } = await read([
      `event: reconnect\ndata: ${data('reconnect')}\n\nevent: bye\ndata: ${data('bye', { reason: 'evicted' })}\n\n`,
    ]);

    expect(reason).toBe('evicted');
  });

  it('answers null for a bye without a reason', async () => {
    const { reason } = await read([`event: bye\ndata: ${data('bye')}\n\n`]);

    expect(reason).toBeNull();
  });

  it('answers null when the stream ends mid-block', async () => {
    const { reason, seen } = await read([
      `event: reconnect\ndata: ${data('reconnect')}`,
    ]);

    expect(reason).toBeNull();
    expect(seen).toEqual([]);
  });

  it('answers null for an empty stream', async () => {
    const { reason, seen } = await read([]);

    expect(reason).toBeNull();
    expect(seen).toEqual([]);
  });
});
