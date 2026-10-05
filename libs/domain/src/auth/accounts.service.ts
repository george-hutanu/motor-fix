import { Inject, Injectable } from '@nestjs/common';

import type { Role } from './capabilities';
import type { Actor } from './policy';
import { PRISMA } from './prisma';
import { AUDIT_PORT, type AuditPort } from '../audit/audit.port';
import { EVENT_PORT, type EventPort } from '../events/event.port';
import type { Prisma, PrismaClient } from '../generated/prisma/client';

// Identities whose provider has already checked the e-mail.
const VOUCHED = new Set(['google', 'apple']);

export interface NewAccount {
  name: string;
  email?: string;
  phone?: string;
  language?: 'ro' | 'en';
  // Passed by server code only: no public endpoint may choose a role.
  roles: readonly Role[];
  identity: {
    method: 'password' | 'google' | 'apple' | 'whatsapp_phone';
    subject: string;
    passwordHash?: string;
  };
}

@Injectable()
export class AccountsService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(AUDIT_PORT) private readonly audit: AuditPort,
    @Inject(EVENT_PORT) private readonly events: EventPort,
  ) {}

  async createAccount(input: NewAccount): Promise<{ id: string }> {
    const roles = [...new Set(input.roles)];
    const [first] = roles;
    if (!first) throw new Error('an account needs at least one role');
    return this.prisma.$transaction(async (tx) => {
      const { id } = await tx.account.create({
        data: {
          email: input.email?.trim().toLowerCase(),
          emailVerifiedAt:
            input.email && VOUCHED.has(input.identity.method)
              ? new Date()
              : undefined,
          identities: { create: input.identity },
          language: input.language,
          lastRole: first,
          name: input.name,
          phone: input.phone,
          roles: { create: roles.map((role) => ({ role })) },
        },
        select: { id: true },
      });
      for (const role of roles) {
        await this.audit.record(tx, {
          action: 'create',
          actorId: id,
          actorRole: role,
          field: 'role',
          newValue: role,
          subjectId: id,
          subjectType: 'account',
        });
      }
      await this.events.record(tx, {
        kind: 'account.created',
        payload: {
          accountId: id,
          method: input.identity.method,
          roles,
        },
        subjectId: id,
      });
      return { id };
    });
  }

  async setLanguage(actor: Actor, language: 'ro' | 'en'): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const where = { id: actor.accountId };
      const before = await tx.account.findUniqueOrThrow({
        select: { language: true },
        where,
      });
      if (before.language === language) return;
      // Only the change that still finds the old value writes, so two at once
      // leave one audit entry.
      const { count } = await tx.account.updateMany({
        data: { language },
        where: { ...where, language: before.language },
      });
      if (count === 0) return;
      await this.audit.recordChanges(
        tx,
        {
          actorId: actor.accountId,
          actorRole: actor.role,
          subjectId: actor.accountId,
          subjectType: 'account',
        },
        before,
        { language },
      );
    });
  }

  async grantRole(
    tx: Prisma.TransactionClient,
    by: { id: string | null; role: Role | 'system' },
    accountId: string,
    role: Role,
  ) {
    const { count } = await tx.accountRole.createMany({
      data: [{ accountId, role }],
      skipDuplicates: true,
    });
    if (count === 0) return;
    await this.audit.record(tx, {
      action: 'update',
      actorId: by.id,
      actorRole: by.role,
      field: 'role',
      newValue: role,
      oldValue: null,
      subjectId: accountId,
      subjectType: 'account',
    });
  }
}
