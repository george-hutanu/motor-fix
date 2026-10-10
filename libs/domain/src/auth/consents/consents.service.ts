import type {
  ConsentRecordedDto,
  MyConsentsDto,
  RecordConsentDto,
} from '@motor-fix/contracts';
import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';

import { CLOCK_AHEAD_MS } from './consents';
import { ConsentThrottle } from './consents.throttle';
import { AUDIT_PORT, type AuditPort } from '../../audit/audit.port';
import type { PrismaClient } from '../../generated/prisma/client';
import { countConsentRecord } from '../../metrics/product-counters';
import type { Actor } from '../policy';
import { PRISMA } from '../prisma';

// Analytics choices are only ever added: the latest `at` per account is the
// one in force, and the history stays for proof.
@Injectable()
export class ConsentsService {
  private readonly logger = new Logger('Consents');

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(AUDIT_PORT) private readonly audit: AuditPort,
    private readonly throttle: ConsentThrottle,
  ) {}

  // Without an actor the choice is a visitor's and goes under no account.
  async record(
    input: RecordConsentDto,
    address: string,
    actor?: Actor,
  ): Promise<ConsentRecordedDto> {
    const at = new Date(input.at);
    if (at.getTime() > Date.now() + CLOCK_AHEAD_MS) {
      throw new BadRequestException({
        code: 'consent_time_ahead',
        message: 'The choice is dated ahead of the server clock',
      });
    }
    const wait = await this.throttle.take(address);
    if (wait !== null) {
      throw new HttpException(
        {
          code: 'consent_rate_limited',
          message: 'Too many choices from here; try again later',
          retryAfterSeconds: wait,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    const data = {
      accountId: actor?.accountId ?? null,
      at,
      browserConsentId: input.browserConsentId,
      decision: input.decision,
      kind: 'analytics' as const,
      language: input.language,
      textVersion: input.textVersion,
    };
    const { id } = await this.prisma.$transaction(async (tx) => {
      const row = await tx.consentRecord.create({ data, select: { id: true } });
      if (actor) {
        await this.audit.record(tx, {
          action: 'create',
          actorId: actor.accountId,
          actorRole: actor.role,
          field: 'analyticsConsent',
          newValue: {
            decision: input.decision,
            textVersion: input.textVersion,
          },
          subjectId: actor.accountId,
          subjectType: 'account',
        });
      }
      return row;
    });
    this.logger.log(
      `analytics consent ${input.decision} stored for a ${actor ? 'signed-in person' : 'visitor'}`,
    );
    countConsentRecord(input.decision);
    return { id };
  }

  async mine(accountId: string): Promise<MyConsentsDto> {
    const [analytics, accepted] = await Promise.all([
      this.prisma.consentRecord.findFirst({
        orderBy: [{ at: 'desc' }, { createdAt: 'desc' }],
        select: { at: true, decision: true, language: true, textVersion: true },
        where: { accountId, kind: 'analytics' },
      }),
      this.prisma.accountConsent.findMany({
        distinct: ['kind'],
        orderBy: [{ kind: 'asc' }, { acceptedAt: 'desc' }],
        select: {
          acceptedAt: true,
          kind: true,
          language: true,
          textVersion: true,
        },
        where: { accountId },
      }),
    ]);
    return {
      accepted: accepted.map((text) => ({
        ...text,
        acceptedAt: text.acceptedAt.toISOString(),
      })),
      analytics: analytics && {
        ...analytics,
        at: analytics.at.toISOString(),
      },
    };
  }
}
