import type { PrismaClient } from '../../generated/prisma/client';

// The most notifications one returning stream is written; the bell's own
// reads fill in anything older.
export const REPLAY_LIMIT = 200;

export interface ReplayRow {
  id: string;
  position: bigint;
  createdAt: Date;
}

export type LoadReplay = (
  accountId: string,
  since: bigint,
) => Promise<{ rows: ReplayRow[]; unreadCount: number }>;

// The account's in-app notifications after a position, oldest first, with
// its unread count as it stands now.
export const loadReplay =
  (prisma: PrismaClient): LoadReplay =>
  async (accountId, since) => {
    const [rows, account] = await prisma.$transaction([
      prisma.notification.findMany({
        orderBy: { position: 'asc' },
        select: { createdAt: true, id: true, position: true },
        take: REPLAY_LIMIT,
        where: { accountId, channel: 'in_app', position: { gt: since } },
      }),
      prisma.account.findUnique({
        select: { unreadCount: true },
        where: { id: accountId },
      }),
    ]);
    return { rows, unreadCount: account?.unreadCount ?? 0 };
  };
