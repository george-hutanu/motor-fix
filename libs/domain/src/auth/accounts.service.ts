import { Inject, Injectable } from '@nestjs/common';

import type { Role } from './capabilities';
import { type Consent, consentRequired, isCurrentConsent } from './consent';
import type { Actor } from './policy';
import { PRISMA } from './prisma';
import { AUDIT_PORT, type AuditPort } from '../audit/audit.port';
import { EVENT_PORT, type EventPort } from '../events/event.port';
import type { Prisma, PrismaClient } from '../generated/prisma/client';
import { countAccountChange } from '../metrics/product-counters';

// Identities whose provider has already checked the e-mail.
const VOUCHED = new Set(['google', 'apple']);

interface MyDetails {
  language?: 'ro' | 'en';
  name?: string;
  city?: string | null;
}

// Sorted, so the audit rows and the event list the fields in one order.
const MY_DETAILS = ['city', 'language', 'name'] as const;

interface NewAccount {
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
  // Whether the e-mail counts as confirmed; by default, when a provider that
  // checks e-mails vouches for it.
  emailVerified?: boolean;
  // Checked here, so no method can create an account without it.
  consent: Consent;
}

@Injectable()
export class AccountsService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(AUDIT_PORT) private readonly audit: AuditPort,
    @Inject(EVENT_PORT) private readonly events: EventPort,
  ) {}

  // `before` runs at the start of the account's transaction; when it throws,
  // nothing is created.
  async createAccount(
    input: NewAccount,
    before?: (tx: Prisma.TransactionClient) => Promise<void>,
  ): Promise<{ id: string }> {
    const roles = [...new Set(input.roles)];
    const [first] = roles;
    if (!first) throw new Error('an account needs at least one role');
    if (!isCurrentConsent(input.consent)) throw consentRequired();
    const { privacyVersion, termsVersion } = input.consent;
    const language = input.language ?? 'ro';
    const { method } = input.identity;
    return this.prisma.$transaction(async (tx) => {
      await before?.(tx);
      const { id } = await tx.account.create({
        data: {
          consents: {
            create: [
              { kind: 'terms', language, method, textVersion: termsVersion },
              {
                kind: 'privacy_notice',
                language,
                method,
                textVersion: privacyVersion,
              },
            ],
          },
          email: input.email?.trim().toLowerCase(),
          emailVerifiedAt:
            input.email &&
            (input.emailVerified ?? VOUCHED.has(input.identity.method))
              ? new Date()
              : undefined,
          identities: { create: input.identity },
          language,
          lastRole: first,
          name: input.name,
          phone: input.phone,
          // A WhatsApp sign-in proved the number by its code.
          phoneVerifiedAt:
            method === 'whatsapp_phone' &&
            input.phone === input.identity.subject
              ? new Date()
              : undefined,
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
      await this.audit.record(tx, {
        action: 'create',
        actorId: id,
        actorRole: first,
        field: 'consent',
        newValue: { privacyVersion, termsVersion },
        subjectId: id,
        subjectType: 'account',
      });
      await this.events.record(tx, {
        audience: { accountId: id, type: 'account' },
        kind: 'account.created',
        payload: {
          accountId: id,
          method,
          roles,
        },
        subjectId: id,
      });
      return { id };
    });
  }

  // The account's own language, name and city: a field left out is kept,
  // and nothing is written when nothing changed.
  async updateMe(actor: Actor, patch: MyDetails): Promise<void> {
    const saved = await this.prisma.$transaction(async (tx) => {
      const where = { id: actor.accountId };
      const before = await tx.account.findUniqueOrThrow({
        select: { city: true, language: true, name: true },
        where,
      });
      // A fixed list: a field the caller sent beyond these is never written.
      const changed = MY_DETAILS.filter(
        (field) => patch[field] !== undefined && patch[field] !== before[field],
      );
      if (changed.length === 0) return [];
      const data = Object.fromEntries(changed.map((f) => [f, patch[f]]));
      // Only the change that still finds the old values writes, so two at
      // once leave one audit entry per field.
      const { count } = await tx.account.updateMany({
        data,
        where: {
          ...where,
          ...Object.fromEntries(changed.map((f) => [f, before[f]])),
        },
      });
      if (count === 0) return [];
      await this.audit.recordChanges(
        tx,
        {
          actorId: actor.accountId,
          actorRole: actor.role,
          ...(actor.via === 'assistant' && {
            assistantGrantId: actor.assistantGrantId,
            requestId: actor.requestId,
          }),
          subjectId: actor.accountId,
          subjectType: 'account',
        },
        before,
        data,
      );
      await this.events.record(tx, {
        audience: { accountId: actor.accountId, type: 'account' },
        kind: 'account.updated',
        payload: { accountId: actor.accountId, fields: changed },
        subjectId: actor.accountId,
      });
      return changed;
    });
    for (const field of saved) {
      if (field !== 'language') countAccountChange(field);
    }
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
