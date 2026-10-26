import type { PrismaClient } from '../../generated/prisma/client';

export interface ReportCounts {
  pending: number;
  overdue: number;
  oldestCreatedAt: Date | null;
}

// The pending review reports: how many, how many past their due time (from
// the very moment they are due), and when the oldest was made. The overview
// and the queue read the same numbers.
export async function countReportQueue(
  prisma: PrismaClient,
  now: Date,
): Promise<ReportCounts> {
  const [pending, overdue, oldest] = await Promise.all([
    prisma.reviewReport.count({ where: { status: 'pending' } }),
    prisma.reviewReport.count({
      where: { dueAt: { lte: now }, status: 'pending' },
    }),
    prisma.reviewReport.findFirst({
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { createdAt: true },
      where: { status: 'pending' },
    }),
  ]);
  return { oldestCreatedAt: oldest?.createdAt ?? null, overdue, pending };
}
