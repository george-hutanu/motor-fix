import { emailConfig } from './email-config';
import { AuditService } from '../audit/audit.service';
import { AccountsService } from '../auth/accounts.service';
import type { Role } from '../auth/capabilities';
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
    prisma,
    reset: () => prisma.$executeRawUnsafe('TRUNCATE account, garage CASCADE'),
  };
}
