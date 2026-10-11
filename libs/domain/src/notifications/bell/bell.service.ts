import type {
  NotificationDto,
  NotificationListQueryDto,
  NotificationPageDto,
} from '@motor-fix/contracts';
import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';

import { bellLink } from './bell.link';
import type { Role } from '../../auth/capabilities';
import { LIVE_CHANNEL } from '../../events/live/live.hub';
import type { Notification, PrismaClient } from '../../generated/prisma/client';
import {
  LIVE_PUBLISHER,
  NOTIFICATIONS_PRISMA,
  type Publisher,
} from '../notifications.service';
import { bellText } from '../templates';

const PAGE = 20;
const WINDOW_DAYS = 90;

// What the bell shows: a person's own in-app rows of the last 90 days.
@Injectable()
export class BellService {
  private readonly logger = new Logger('Bell');

  constructor(
    @Inject(NOTIFICATIONS_PRISMA) private readonly prisma: PrismaClient,
    @Inject(LIVE_PUBLISHER) private readonly publisher: Publisher,
  ) {}

  // `role` is the dashboard asking: only the driver's maps a row to a view.
  async list(
    accountId: string,
    query: NotificationListQueryDto,
    role: Role,
  ): Promise<NotificationPageDto> {
    const where = this.shown(accountId);
    if (
      query.cursor &&
      !(await this.prisma.notification.findFirst({
        select: { id: true },
        where: { ...where, id: query.cursor },
      }))
    ) {
      throw new HttpException(
        {
          code: 'invalid_cursor',
          message: "cursor is not one of this person's notifications",
        },
        HttpStatus.BAD_REQUEST,
      );
    }
    const [rows, language] = await Promise.all([
      this.prisma.notification.findMany({
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: PAGE + 1,
        where,
        ...(query.cursor && { cursor: { id: query.cursor }, skip: 1 }),
      }),
      query.language ?? this.language(accountId),
    ]);
    const page = rows.slice(0, PAGE);
    return {
      items: page.map((row) => view(row, language, role)),
      nextCursor: rows.length > PAGE ? (page.at(-1)?.id ?? null) : null,
    };
  }

  unreadCount(accountId: string): Promise<number> {
    return this.prisma.notification.count({
      where: { ...this.shown(accountId), readAt: null },
    });
  }

  // The first read time stays: a second open changes nothing.
  async read(
    accountId: string,
    id: string,
    role: Role,
  ): Promise<NotificationDto> {
    const where = { accountId, channel: 'in_app' as const, id };
    const { count } = await this.prisma.notification.updateMany({
      data: { readAt: new Date() },
      where: { ...where, readAt: null },
    });
    const [row, language] = await Promise.all([
      this.prisma.notification.findFirst({ where }),
      this.language(accountId),
    ]);
    if (!row) throw new NotFoundException();
    if (count) await this.announce(accountId, id);
    return view(row, language, role);
  }

  async readAll(accountId: string): Promise<void> {
    const { count } = await this.prisma.notification.updateMany({
      data: { readAt: new Date() },
      where: { accountId, channel: 'in_app', readAt: null },
    });
    if (count) await this.announce(accountId, accountId);
  }

  private shown(accountId: string) {
    return {
      accountId,
      channel: 'in_app' as const,
      createdAt: { gte: new Date(Date.now() - WINDOW_DAYS * 86_400_000) },
    };
  }

  private async language(accountId: string): Promise<string> {
    const account = await this.prisma.account.findUnique({
      select: { language: true },
      where: { id: accountId },
    });
    return account?.language ?? 'ro';
  }

  // The person's other tabs follow a read that changed something; `id` is
  // the row read, or the account when all were.
  private async announce(accountId: string, id: string) {
    const message = {
      audience: [`account:${accountId}`],
      event: { at: new Date().toISOString(), id, kind: 'notification.read' },
    };
    try {
      await this.publisher.publish(LIVE_CHANNEL, JSON.stringify(message));
    } catch {
      this.logger.warn(
        `read of ${id} not announced live: Redis did not answer`,
      );
    }
  }
}

// The same kinds also reach garage staff, so a row read from any other
// dashboard opens nothing and is only marked read.
function view(
  row: Notification,
  language: string,
  role: Role,
): NotificationDto {
  return {
    at: row.createdAt.toISOString(),
    id: row.id,
    kind: row.kind,
    link: role === 'driver' ? bellLink(row) : null,
    readAt: row.readAt?.toISOString() ?? null,
    subjectId: row.subjectId,
    text: bellText(row.kind, language, row.params as Record<string, unknown>),
  };
}
