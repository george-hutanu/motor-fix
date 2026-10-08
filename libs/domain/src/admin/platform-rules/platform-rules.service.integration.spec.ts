import { HttpException } from '@nestjs/common';

import { PlatformRulesService } from './platform-rules.service';
import type { AuditPort } from '../../audit/audit.port';
import { AuditService } from '../../audit/audit.service';
import type { Actor } from '../../auth/policy';
import { serialDatabase } from '../../auth/serial-db.testing';
import { outbox } from '../../events/event.port';
import {
  databaseUrl,
  fixtures,
} from '../../notifications/notifications.testing';

const { account, prisma, reset } = fixtures();
serialDatabase(databaseUrl);

const NONE = {
  canAnswerQuotes: false,
  canMoveBookings: false,
  canRecordFinalPrice: false,
};
const TEST_ONLY = ['skip_manual_approval', 'skip_rar_check'];

const rules = (production: boolean, audit: AuditPort = new AuditService()) =>
  new PlatformRulesService(prisma, audit, outbox, { production });

let ioana: Actor;

async function refusal(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    if (error instanceof HttpException) {
      return {
        code: (error.getResponse() as { code?: string }).code,
        status: error.getStatus(),
      };
    }
    throw error;
  }
  throw new Error('the call was not refused');
}

const rule = (key: string) =>
  prisma.platformRule.findUniqueOrThrow({ where: { key } });
const entries = () =>
  prisma.activityLog.findMany({
    where: { actorId: ioana.accountId, subjectType: 'platform_rule' },
  });
const events = () =>
  prisma.outboxEvent.findMany({ where: { kind: 'platform_rule.changed' } });

beforeEach(async () => {
  await reset();
  await prisma.outboxEvent.deleteMany();
  await prisma.platformRule.deleteMany({ where: { key: { in: TEST_ONLY } } });
  await prisma.platformRule.updateMany({
    data: { updatedAt: null, updatedBy: null, value: false },
    where: { key: 'maintenance_mode' },
  });
  await prisma.platformRule.updateMany({
    data: { updatedAt: null, updatedBy: null, value: true },
    where: { key: 'reviews_only_after_confirmed_job' },
  });
  await prisma.platformRule.createMany({
    data: TEST_ONLY.map((key) => ({ defaultValue: false, key, value: false })),
  });
  const id = await account('Ioana Popa', ['admin']);
  ioana = {
    accountId: id,
    garageId: null,
    permissions: NONE,
    role: 'admin',
    roles: ['admin'],
  };
});

afterAll(() => prisma.$disconnect());

describe('listing the platform rules', () => {
  it('lists every rule with its value, default, two-admin flag and last change, outside production', async () => {
    const list = await rules(false).list(ioana);

    expect(list.production).toBe(false);
    expect(list.rules).toEqual([
      {
        defaultValue: false,
        key: 'maintenance_mode',
        requiresTwoAdmins: false,
        updatedAt: null,
        updatedBy: null,
        value: false,
      },
      {
        defaultValue: true,
        key: 'reviews_only_after_confirmed_job',
        requiresTwoAdmins: true,
        updatedAt: null,
        updatedBy: null,
        value: true,
      },
      {
        defaultValue: false,
        key: 'skip_manual_approval',
        requiresTwoAdmins: false,
        updatedAt: null,
        updatedBy: null,
        value: false,
      },
      {
        defaultValue: false,
        key: 'skip_rar_check',
        requiresTwoAdmins: false,
        updatedAt: null,
        updatedBy: null,
        value: false,
      },
    ]);
  });

  it('hides the test-only rules in production even when the table holds them', async () => {
    const list = await rules(true).list(ioana);

    expect(list.production).toBe(true);
    expect(list.rules.map((r) => r.key)).toEqual([
      'maintenance_mode',
      'reviews_only_after_confirmed_job',
    ]);
  });
});

describe('changing a platform rule', () => {
  it('saves the new value with who changed it and when', async () => {
    const before = Date.now();

    const saved = await rules(false).change(ioana, 'maintenance_mode', {
      seen: false,
      value: true,
    });

    const row = await rule('maintenance_mode');
    expect(row).toMatchObject({ updatedBy: ioana.accountId, value: true });
    expect(row.updatedAt?.getTime()).toBeGreaterThanOrEqual(before);
    expect(saved).toMatchObject({
      key: 'maintenance_mode',
      updatedBy: ioana.accountId,
      value: true,
    });
  });

  it('refuses an unknown key with 404', async () => {
    expect(
      await refusal(
        rules(false).change(ioana, 'free_beer', { seen: false, value: true }),
      ),
    ).toEqual({ code: 'not_found', status: 404 });
  });

  it('refuses a test-only key in production with 404 and leaves it as it was', async () => {
    expect(
      await refusal(
        rules(true).change(ioana, 'skip_rar_check', {
          seen: false,
          value: true,
        }),
      ),
    ).toEqual({ code: 'not_found', status: 404 });
    expect((await rule('skip_rar_check')).value).toBe(false);
  });

  it('accepts a test-only key outside production', async () => {
    await rules(false).change(ioana, 'skip_rar_check', {
      seen: false,
      value: true,
    });

    expect((await rule('skip_rar_check')).value).toBe(true);
  });

  it('refuses a value that is not of the rule shape with 400', async () => {
    expect(
      await refusal(
        rules(false).change(ioana, 'maintenance_mode', {
          seen: false,
          value: 'yes',
        }),
      ),
    ).toEqual({ code: 'validation_failed', status: 400 });
  });

  it('refuses a stale seen value with 409 before anything else', async () => {
    expect(
      await refusal(
        rules(false).change(ioana, 'reviews_only_after_confirmed_job', {
          seen: false,
          value: false,
        }),
      ),
    ).toEqual({ code: 'stale_value', status: 409 });
  });

  it('answers an unchanged value with the rule as it is and writes nothing', async () => {
    const answer = await rules(false).change(ioana, 'maintenance_mode', {
      seen: false,
      value: false,
    });

    expect(answer).toMatchObject({ updatedBy: null, value: false });
    expect(await rule('maintenance_mode')).toMatchObject({ updatedAt: null });
    expect(await entries()).toHaveLength(0);
    expect(await events()).toHaveLength(0);
  });

  it('refuses to switch off a two-admin rule with 409 two_admins_required', async () => {
    expect(
      await refusal(
        rules(false).change(ioana, 'reviews_only_after_confirmed_job', {
          seen: true,
          value: false,
        }),
      ),
    ).toEqual({ code: 'two_admins_required', status: 409 });
    expect((await rule('reviews_only_after_confirmed_job')).value).toBe(true);
  });

  it('lets one admin switch a two-admin rule back on', async () => {
    await prisma.platformRule.update({
      data: { value: false },
      where: { key: 'reviews_only_after_confirmed_job' },
    });

    const answer = await rules(false).change(
      ioana,
      'reviews_only_after_confirmed_job',
      { seen: false, value: true },
    );

    expect(answer).toMatchObject({ updatedBy: ioana.accountId, value: true });
    expect((await rule('reviews_only_after_confirmed_job')).value).toBe(true);
  });

  it('saves one of two simultaneous changes of a rule and refuses the other as stale', async () => {
    const change = () =>
      rules(false).change(ioana, 'maintenance_mode', {
        seen: false,
        value: true,
      });

    const results = await Promise.allSettled([change(), change()]);

    expect(results.map((r) => r.status).sort()).toEqual([
      'fulfilled',
      'rejected',
    ]);
    const rejected = results.find((r) => r.status === 'rejected');
    expect(
      await refusal(Promise.reject((rejected as PromiseRejectedResult).reason)),
    ).toEqual({ code: 'stale_value', status: 409 });
    expect(await entries()).toHaveLength(1);
  });

  it('records the change event for the admins only', async () => {
    await rules(false).change(ioana, 'skip_manual_approval', {
      seen: false,
      value: true,
    });

    const [event, ...more] = await events();
    expect(more).toHaveLength(0);
    expect(event).toMatchObject({
      audience: ['admin'],
      payload: { key: 'skip_manual_approval', new: true, old: false },
      subjectId: 'skip_manual_approval',
    });
  });

  it('records a maintenance change for the admins and the system channel', async () => {
    await rules(false).change(ioana, 'maintenance_mode', {
      seen: false,
      value: true,
    });

    const [event] = await events();
    expect(event?.audience).toEqual(['admin', 'system']);
    expect(event?.payload).toEqual({
      key: 'maintenance_mode',
      new: true,
      old: false,
    });
  });
});

describe('the record of a platform rule change', () => {
  it('writes one history entry with the admin, the key and both values', async () => {
    await rules(false).change(ioana, 'maintenance_mode', {
      seen: false,
      value: true,
    });

    const [entry, ...more] = await entries();
    expect(more).toHaveLength(0);
    expect(entry).toMatchObject({
      action: 'update',
      actorId: ioana.accountId,
      actorRole: 'admin',
      field: 'maintenance_mode',
      garageId: null,
      kind: 'platform_rule_changed',
      newValue: true,
      oldValue: false,
      subjectId: (await rule('maintenance_mode')).id,
    });
  });

  it('leaves the value, the entry and the event unwritten when the entry fails', async () => {
    const failing: AuditPort = {
      record: () => Promise.reject(new Error('audit down')),
      recordChanges: () => Promise.reject(new Error('audit down')),
    };

    await expect(
      rules(false, failing).change(ioana, 'maintenance_mode', {
        seen: false,
        value: true,
      }),
    ).rejects.toThrow('audit down');

    expect((await rule('maintenance_mode')).value).toBe(false);
    expect(await events()).toHaveLength(0);
  });

  it('writes no entry and no event for a refused change', async () => {
    await refusal(
      rules(false).change(ioana, 'reviews_only_after_confirmed_job', {
        seen: true,
        value: false,
      }),
    );

    expect(await entries()).toHaveLength(0);
    expect(await events()).toHaveLength(0);
  });
});
