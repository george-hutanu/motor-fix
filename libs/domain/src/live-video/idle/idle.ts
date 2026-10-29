import type { AuditPort } from '../../audit/audit.port';
import type { PrismaClient } from '../../generated/prisma/client';
import type {
  InputStatus,
  LiveVideoProvider,
} from '../providers/live-video.provider';
import {
  countLiveIdleStop,
  recordIdleCheck,
} from '../sessions/sessions.metrics';
import { stopLiveSessions } from '../stop-sessions';

export const LIVE_IDLE_QUEUE = 'live-idle';

export const LIVE_IDLE = {
  // How long a live session may go with no publisher.
  afterMs: 10 * 60_000,
  // How often the worker checks every live session.
  everyMs: 60_000,
} as const;

interface LiveIdleDeps {
  prisma: PrismaClient;
  provider: Pick<LiveVideoProvider, 'name' | 'inputStatus'>;
  audit: AuditPort;
  logger: { log(line: string): void; warn(line: string): void };
}

// A session is idle once it has had no publisher for ten minutes straight,
// counted from the drop, or from its start when nobody ever published.
export function isIdle(status: InputStatus, startedAt: Date, now: Date) {
  if (status.connected) return false;
  const since = Math.max(status.since?.getTime() ?? 0, startedAt.getTime());
  return now.getTime() - since >= LIVE_IDLE.afterMs;
}

interface LiveRow {
  id: string;
  garageId: string;
  providerInputId: string;
  startedAt: Date;
}

// One session: its state read, and stopped when idle, in its own
// transaction. The garage first, the order every live write takes it; a
// session a sender or the system stopped meanwhile is left as it is.
async function stopWhenIdle(
  deps: LiveIdleDeps,
  session: LiveRow,
  now: Date,
): Promise<boolean> {
  let status: InputStatus;
  try {
    status = await deps.provider.inputStatus(session.providerInputId);
  } catch (error) {
    deps.logger.warn(
      `live idle check skipped: session ${session.id} input ${session.providerInputId} ${error instanceof Error ? error.name : 'error'}`,
    );
    return false;
  }
  if (!isIdle(status, session.startedAt, now)) return false;
  const rows = await deps.prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM garage WHERE id = ${session.garageId}::uuid FOR SHARE`;
    return stopLiveSessions(tx, deps.audit, { sessionId: session.id }, 'idle');
  });
  if (rows.length === 0) return false;
  countLiveIdleStop();
  deps.logger.log(`live session ${session.id} stopped: idle`);
  return true;
}

// Stops, as the system, every live session of this worker's provider that
// has been idle for ten minutes, through the one stop routine, so it keeps
// or discards its recording as the sender last chose. A session whose state
// the provider cannot tell is left for the next check. Returns how many it
// stopped.
export async function stopIdleSessions(
  deps: LiveIdleDeps,
  now: Date,
): Promise<number> {
  const { provider } = deps;
  if (provider.name === 'none') return 0;
  const began = performance.now();
  try {
    const live = await deps.prisma.liveSession.findMany({
      orderBy: { startedAt: 'asc' },
      select: {
        garageId: true,
        id: true,
        providerInputId: true,
        startedAt: true,
      },
      where: { provider: provider.name, stoppedAt: null },
    });
    let stopped = 0;
    for (const session of live) {
      if (await stopWhenIdle(deps, session, now)) stopped += 1;
    }
    return stopped;
  } finally {
    recordIdleCheck((performance.now() - began) / 1000);
  }
}
