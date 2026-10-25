import { randomUUID } from 'node:crypto';

import { CURRENT_CONSENT } from '@motor-fix/contracts';
import type { Role } from '@motor-fix/contracts/capabilities';

import { emailConfig } from './email-config';
import { phoneConfig } from './phone-config';
import { AuditService } from '../audit/audit.service';
import { AccountsService } from '../auth/accounts.service';
import { createPrisma } from '../auth/prisma';
import { noEvents } from '../events/event.port';
import type { PrismaClient } from '../generated/prisma/client';

export const databaseUrl =
  process.env['DATABASE_URL'] ?? 'postgresql://localhost:5432/postgres';

// Each spec file names its own Redis database so their queues never meet.
export const redisUrlFor = (db: number) =>
  `${(process.env['REDIS_URL'] ?? 'redis://localhost:6379').replace(/\/\d*$/, '')}/${db}`;

export const testConfig = (
  brevoUrl: string,
  overrides: Record<string, string> = {},
) =>
  emailConfig('test', {
    BREVO_API_KEY: 'test-key',
    BREVO_API_URL: brevoUrl,
    BREVO_WEBHOOK_SECRET: 'webhook-secret',
    EMAIL_ALLOWLIST: '@example.test',
    EMAIL_FROM: 'MotorFix <noreply@example.test>',
    EMAIL_SENDING: 'on',
    PUBLIC_WEB_URL: 'https://motorfix.test',
    ...overrides,
  });

// Numbers +40710000000 to +40710000009 are allowlisted.
export const testPhone = (n: number) => `+4071000000${n}`;

export const testPhoneConfig = (overrides: Record<string, string> = {}) =>
  phoneConfig('test', {
    PHONE_ALLOWLIST: Array.from({ length: 10 }, (_, n) => testPhone(n)).join(),
    PHONE_SENDING: 'on',
    WHATSAPP_SENDER: '+40700000099',
    WHATSAPP_TEMPLATES: 'motorfix_due_itp_ro=12,motorfix_due_itp_en=13',
    ...overrides,
  });

export function fixtures(prisma: PrismaClient = createPrisma(databaseUrl)) {
  const accounts = new AccountsService(prisma, new AuditService(), noEvents);
  return {
    async account(
      name: string,
      roles: Role[] = ['driver'],
      options: {
        email?: string | null;
        language?: 'ro' | 'en';
        status?: 'active' | 'suspended' | 'deleted';
      } = {},
    ) {
      const email =
        options.email === null
          ? undefined
          : (options.email ?? `${name}@example.test`);
      const { id } = await accounts.createAccount({
        consent: CURRENT_CONSENT,
        email,
        identity: { method: 'google', subject: `${name}-subject` },
        language: options.language,
        name,
        roles,
      });
      if (options.status) {
        await prisma.account.update({
          data: { status: options.status },
          where: { id },
        });
      }
      return id;
    },
    // A Dacia of `ownerId`: what a reminder's foreign key needs.
    async car(ownerId: string, model = 'Logan') {
      const brand = await prisma.brand.upsert({
        create: { key: 'test-dacia', name: 'Dacia', slug: 'test-dacia' },
        update: {},
        where: { name: 'Dacia' },
      });
      const { id } = await prisma.car.create({
        data: {
          brandId: brand.id,
          fuel: 'petrol',
          idempotencyKey: randomUUID(),
          model,
          odometerKm: 90000,
          ownerId,
          year: 2018,
        },
      });
      return id;
    },
    prisma,
    reset: () =>
      prisma.$executeRawUnsafe(
        'TRUNCATE account, garage, listing_draft CASCADE',
      ),
  };
}

// The next `times` transactions that start once `called` says the provider
// had the message fail, as a dropped connection would. Returns the undo.
export function failWritesAfter(
  prisma: PrismaClient,
  called: () => boolean,
  times: number,
) {
  const real = prisma.$transaction;
  prisma.$transaction = ((...args: never[]) => {
    if (times > 0 && called()) {
      times -= 1;
      return Promise.reject(new Error('connection lost'));
    }
    return (real as (...a: never[]) => unknown).apply(prisma, args);
  }) as never;
  return () => {
    prisma.$transaction = real;
  };
}

// Stamps a row's send claim `ms` before the database's clock, which the claim
// lease is judged by, and answers the stamp.
export async function claimAgo(prisma: PrismaClient, id: string, ms: number) {
  const [row] = await prisma.$queryRaw<{ claimedAt: Date }[]>`
    UPDATE notification SET claimed_at = now() - ${ms}::int * interval '1 millisecond'
    WHERE id = ${id}::uuid RETURNING claimed_at AS "claimedAt"`;
  return row.claimedAt;
}
