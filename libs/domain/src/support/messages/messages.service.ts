import {
  type CreateSupportMessageDto,
  supportReference,
} from '@motor-fix/contracts';
import { Inject, Injectable, Logger } from '@nestjs/common';

import type { Role } from '../../auth/capabilities';
import type { Actor } from '../../auth/policy';
import { PRISMA } from '../../auth/prisma';
import { localDay } from '../../bucharest';
import { EVENT_PORT, type EventPort } from '../../events/event.port';
import type { PrismaClient } from '../../generated/prisma/client';

type SenderRole = 'visitor' | 'driver' | 'garage' | 'admin';

// Every garage-side role writes as the garage.
const SENDER: Record<Role, SenderRole> = {
  admin: 'admin',
  driver: 'driver',
  garage: 'garage',
  mechanic: 'garage',
  receptionist: 'garage',
};

// Stores a message and its event in one transaction; the worker sends the
// e-mails from the event, so nothing here waits on Brevo.
@Injectable()
export class SupportMessagesService {
  private readonly logger = new Logger('Support');

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(EVENT_PORT) private readonly events: EventPort,
  ) {}

  async create(
    actor: Actor | undefined,
    dto: CreateSupportMessageDto,
    now = new Date(),
  ): Promise<{ id: string; reference: string }> {
    const year = Number(localDay(now).slice(0, 4));
    const made = await this.prisma.$transaction(async (tx) => {
      const [{ last }] = await tx.$queryRaw<{ last: number }[]>`
        INSERT INTO support_reference (year, last) VALUES (${year}, 1)
        ON CONFLICT (year) DO UPDATE SET last = support_reference.last + 1
        RETURNING last`;
      const row = await tx.supportMessage.create({
        data: {
          accountId: actor?.accountId ?? null,
          email: dto.email,
          language: dto.language,
          message: dto.message,
          name: dto.name,
          reference: supportReference(year, last),
          role: actor ? SENDER[actor.role] : 'visitor',
          subjectRef: dto.subjectRef ?? null,
          topic: dto.topic,
        },
        select: { id: true, reference: true },
      });
      await this.events.record(tx, {
        audience: { adminOnly: true, type: 'platform' },
        kind: 'support.message_received',
        payload: { id: row.id },
        subjectId: row.id,
      });
      return row;
    });
    this.logger.log(`support message ${made.reference} stored`);
    return made;
  }
}
