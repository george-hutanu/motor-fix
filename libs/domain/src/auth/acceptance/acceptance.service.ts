import type { AcceptanceDto } from '@motor-fix/contracts';
import { Inject, Injectable, Logger } from '@nestjs/common';

import { pendingAcceptance } from './acceptance';
import { AUDIT_PORT, type AuditPort } from '../../audit/audit.port';
import type { PrismaClient } from '../../generated/prisma/client';
import { countAcceptance } from '../../metrics/product-counters';
import { consentRequired, isCurrentConsent } from '../consent';
import type { Actor } from '../policy';
import { PRISMA } from '../prisma';

@Injectable()
export class AcceptanceService {
  private readonly logger = new Logger(AcceptanceService.name);

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(AUDIT_PORT) private readonly audit: AuditPort,
  ) {}

  // Records the texts in force for each kind the account has not accepted at
  // that version; the earlier rows stay as the history of what was accepted.
  async accept(actor: Actor, body: AcceptanceDto): Promise<void> {
    if (!isCurrentConsent(body)) throw consentRequired();
    const written = await this.prisma.$transaction(async (tx) => {
      const rows = await tx.accountConsent.findMany({
        select: { acceptedAt: true, kind: true, textVersion: true },
        where: { accountId: actor.accountId },
      });
      if (!pendingAcceptance(rows)) return 0;
      const identity = await tx.accountIdentity.findFirst({
        orderBy: { method: 'asc' },
        select: { method: true },
        where: { accountId: actor.accountId },
      });
      const latest = (kind: 'terms' | 'privacy_notice') =>
        rows
          .filter((row) => row.kind === kind)
          .sort((a, b) => b.acceptedAt.getTime() - a.acceptedAt.getTime())[0]
          ?.textVersion;
      const due = (
        [
          ['terms', body.termsVersion],
          ['privacy_notice', body.privacyVersion],
        ] as const
      ).filter(([kind, version]) => latest(kind) !== version);
      await tx.accountConsent.createMany({
        data: due.map(([kind, textVersion]) => ({
          accountId: actor.accountId,
          kind,
          language: actor.language ?? 'ro',
          method: identity?.method ?? 'password',
          textVersion,
        })),
      });
      await this.audit.record(tx, {
        action: 'create',
        actorId: actor.accountId,
        actorRole: actor.role,
        field: 'consent',
        newValue: {
          privacyVersion: body.privacyVersion,
          termsVersion: body.termsVersion,
        },
        subjectId: actor.accountId,
        subjectType: 'account',
      });
      return due.length;
    });
    if (!written) return;
    countAcceptance();
    this.logger.log(
      `acceptance recorded: terms ${body.termsVersion}, privacy notice ${body.privacyVersion}`,
    );
  }
}
