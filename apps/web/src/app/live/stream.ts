import type { LiveCloseReason, LiveMessage } from '@motor-fix/contracts';

// Milliseconds between failed tries; the last one repeats.
const BACKOFF = [1_000, 2_000, 5_000, 10_000, 30_000];
// The server sends a heartbeat every 25 s; a minute of nothing is a dead stream.
export const SILENT_FOR = 60_000;

// The wait before the next try after this many failed ones in a row, spread
// by a tenth either way so a restarted copy is not met by every tab at once.
export function backoffDelay(failures: number) {
  const base = BACKOFF[Math.min(failures, BACKOFF.length) - 1] ?? 0;
  return Math.round(base * (0.9 + 0.2 * Math.random()));
}

// A block's fields: its data's message, its id line when it is a position,
// and its retry line when it is a number of milliseconds.
function parse(block: string): {
  message: LiveMessage | null;
  id?: string;
  retry?: number;
} {
  const lines = block.split('\n');
  const field = (name: string) =>
    lines
      .filter((line) => line.startsWith(`${name}:`))
      .map((line) => line.slice(name.length + 1).trimStart());
  const id = field('id').at(-1);
  const retry = field('retry').at(-1);
  return {
    message: message(field('data').join('\n')),
    ...(id !== undefined && POSITION.test(id) && { id }),
    ...(retry !== undefined && /^\d+$/.test(retry) && { retry: Number(retry) }),
  };
}

const POSITION = /^\d{1,18}$/;

function message(data: string): LiveMessage | null {
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

// What the reader reports besides the messages.
export interface StreamHooks {
  // A frame read: its message, and its position when it carried one.
  emit: (message: LiveMessage, id: string | undefined) => void;
  // The wait the server asks for before a reconnect.
  retry?: (ms: number) => void;
}

// Emits each message of these blocks and answers why the stream is ending:
// the last bye's reason or a planned reconnect, else `reason`.
function deliver(
  blocks: string[],
  reason: LiveCloseReason | null,
  { emit, retry }: StreamHooks,
) {
  for (const block of blocks) {
    const parsed = parse(block);
    if (parsed.retry !== undefined) retry?.(parsed.retry);
    const { message } = parsed;
    if (!message) continue;
    if (message.kind === 'bye') reason = message.reason ?? null;
    if (message.kind === 'reconnect') reason = 'reconnect';
    emit(message, parsed.id);
  }
  return reason;
}

// Server-sent events arrive in blocks that end with a blank line; a chunk may
// end in the middle of one. Reads until the server closes the stream or an
// abort cancels the reader, and answers why the server ended it, if it said.
export async function readEvents(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  signal: AbortSignal,
  heard: () => void,
  emit: StreamHooks['emit'],
  retry?: StreamHooks['retry'],
): Promise<LiveCloseReason | null> {
  const decoder = new TextDecoder();
  let buffer = '';
  let reason: LiveCloseReason | null = null;
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
    reason = deliver(blocks, reason, { emit, retry });
  }
}
