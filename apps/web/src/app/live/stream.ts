import type { LiveByeReason, LiveMessage } from '@motor-fix/contracts';

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

// Emits each message of these blocks and answers the reason of the last bye
// among them, or `reason` when there is none.
function deliver(
  blocks: string[],
  reason: LiveByeReason | null,
  emit: (message: LiveMessage) => void,
) {
  for (const message of blocks.map(parse)) {
    if (!message) continue;
    if (message.kind === 'bye') reason = message.reason ?? null;
    emit(message);
  }
  return reason;
}

// Server-sent events arrive in blocks that end with a blank line; a chunk may
// end in the middle of one. Reads until the server closes the stream or an
// abort cancels the reader, and answers the reason of the last bye heard.
export async function readEvents(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  signal: AbortSignal,
  heard: () => void,
  emit: (message: LiveMessage) => void,
): Promise<LiveByeReason | null> {
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
    reason = deliver(blocks, reason, emit);
  }
}
