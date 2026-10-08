import { HttpException } from '@nestjs/common';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';

import { PlatformRuleChangesService } from './changes.service';
import { AuditService } from '../../../audit/audit.service';
import type { Actor } from '../../../auth/policy';
import { serialDatabase } from '../../../auth/serial-db.testing';
import { outbox } from '../../../events/event.port';
import { Prisma } from '../../../generated/prisma/client';
import { NotificationsService } from '../../../notifications/notifications.service';
import {
  databaseUrl,
  fixtures,
  redisUrlFor,
  testConfig,
} from '../../../notifications/notifications.testing';
import { PlatformRulesService } from '../platform-rules.service';

const redisUrl = redisUrlFor(7);
const { account, prisma, reset } = fixtures();
serialDatabase(databaseUrl);

const REVIEWS = 'reviews_only_after_confirmed_job';
const TEST_ONLY = ['skip_manual_approval', 'skip_rar_check'];
const WEB = 'https://motorfix.test';
const NONE = {
  canAnswerQuotes: false,
  canMoveBookings: false,
  canRecordFinalPrice: false,
};

const queue = new Queue('notifications', { connection: { url: redisUrl } });
const publisher = new Redis(redisUrl);

let notifications: NotificationsService;
let ioana: Actor;
let mihai: Actor;
let elena: Actor;

const admin = async (name: string): Promise<Actor> => ({
  accountId: await account(name, ['admin']),
  garageId: null,
  permissions: NONE,
  role: 'admin',
  roles: ['admin'],
});

const changes = (
  production = false,
  told: Pick<NotificationsService, 'notify'> = notifications,
) =>
  new PlatformRuleChangesService(
    prisma,
    new AuditService(),
    outbox,
    told as NotificationsService,
    { production, webUrl: WEB },
  );

const rules = () =>
  new PlatformRulesService(
    prisma,
    new AuditService(),
    outbox,
    { production: false, webUrl: WEB },
    { on: async () => false, set: async () => undefined },
  );

async function refusal(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    if (error instanceof HttpException) {
      const body = error.getResponse() as { code?: string; message?: string };
      return {
        code: body.code,
        detail: body.message,
        status: error.getStatus(),
      };
    }
    throw error;
  }
  throw new Error('the call was not refused');
}

const reviews = () =>
  prisma.platformRule.findUniqueOrThrow({ where: { key: REVIEWS } });
const stored = () => prisma.platformRuleChange.findMany();
let since = new Date(0);
const entries = () =>
  prisma.activityLog.findMany({
    orderBy: { at: 'asc' },
    where: {
      at: { gte: since },
      subjectType: { in: ['platform_rule', 'platform_rule_change'] },
    },
  });
const events = () =>
  prisma.outboxEvent.findMany({
    orderBy: { id: 'asc' },
    where: { kind: { startsWith: 'platform_rule.' } },
  });
const alerts = (channel: 'email' | 'push' = 'email') =>
  prisma.notification.findMany({
    where: { channel, kind: 'ADMIN_RULE_APPROVAL_NEEDED' },
  });

const ask = (actor: Actor, reason = 'Testăm recenziile din profil.') =>
  changes().request(actor, { key: REVIEWS, reason });

afterAll(async () => {
  await queue.close();
  publisher.disconnect();
  await prisma.$disconnect();
});

beforeEach(async () => {
  await reset();
  await queue.obliterate({ force: true });
  await prisma.platformRuleChange.deleteMany();
  // activity_log is append-only: read only what this test wrote.
  [{ now: since }] = await prisma.$queryRaw<{ now: Date }[]>`
    SELECT clock_timestamp() AS now`;
  await prisma.outboxEvent.deleteMany();
  await prisma.platformRule.deleteMany({ where: { key: { in: TEST_ONLY } } });
  await prisma.platformRule.createMany({
    data: TEST_ONLY.map((key) => ({ defaultValue: false, key, value: false })),
  });
  await prisma.platformRule.updateMany({
    data: { updatedAt: null, updatedBy: null, value: true },
    where: { key: REVIEWS },
  });
  notifications = new NotificationsService(
    prisma,
    queue,
    publisher,
    testConfig('http://127.0.0.1:9'),
    null,
    new AuditService(),
  );
  ioana = await admin('Ioana Popa');
  mihai = await admin('Mihai Ionescu');
  elena = await admin('Elena Stan');
});

describe('asking to switch a rule off', () => {
  it('keeps the request with the reason and the asker, and leaves the rule on', async () => {
    const asked = await ask(ioana, '  Testăm recenziile din profil.  ');

    expect(asked).toMatchObject({
      decidedAt: null,
      decidedByName: null,
      key: REVIEWS,
      mine: true,
      reason: 'Testăm recenziile din profil.',
      requestedByName: 'Ioana',
      status: 'requested',
    });
    expect((await reviews()).value).toBe(true);
    const [row] = await stored();
    expect(row).toMatchObject({
      newValue: false,
      oldValue: true,
      requestedBy: ioana.accountId,
      ruleKey: REVIEWS,
      status: 'requested',
    });
  });

  it.each([
    ['an unknown rule', 'no_such_rule', false],
    ['a rule that needs one admin', 'maintenance_mode', false],
    ['a test-only rule in production', 'skip_rar_check', true],
  ])('refuses %s with 404', async (_, key, production) => {
    const res = await refusal(
      changes(production).request(ioana, { key, reason: 'Un motiv bun.' }),
    );

    expect(res).toMatchObject({ code: 'not_found', status: 404 });
    expect(await stored()).toHaveLength(0);
  });

  it('refuses an unknown rule with 404 before a reason that is too short', async () => {
    const res = await refusal(
      changes().request(ioana, { key: 'no_such_rule', reason: 'x' }),
    );

    expect(res.status).toBe(404);
  });

  it.each([
    ['missing', undefined],
    ['four characters after trimming', '  abcd  '],
    ['301 characters', 'a'.repeat(301)],
    ['not text', 12345],
  ])('refuses a reason %s with 400 validation_failed', async (_, reason) => {
    const res = await refusal(
      changes().request(ioana, { key: REVIEWS, reason } as never),
    );

    expect(res).toMatchObject({ code: 'validation_failed', status: 400 });
    expect(await stored()).toHaveLength(0);
  });

  it('accepts a reason of exactly 5 and of exactly 300 characters', async () => {
    const five = await ask(ioana, 'abcde');
    await changes().cancel(ioana, five.id);

    const long = await ask(ioana, 'a'.repeat(300));

    expect(long.reason).toHaveLength(300);
  });

  it('refuses a rule already off with 409 stale_value before a waiting request', async () => {
    await prisma.platformRule.update({
      data: { value: false },
      where: { key: REVIEWS },
    });

    const res = await refusal(ask(ioana));

    expect(res).toMatchObject({ code: 'stale_value', status: 409 });
  });

  it('refuses a second request while one waits with 409 change_pending', async () => {
    await ask(ioana);

    const res = await refusal(ask(mihai));

    expect(res).toMatchObject({ code: 'change_pending', status: 409 });
    expect(await stored()).toHaveLength(1);
  });

  // The one-waiting index is the last word should two requests pass the row
  // lock: its clash is the same 409, not a 500.
  it('answers change_pending when the one-waiting index refuses the insert', async () => {
    const clash = new Prisma.PrismaClientKnownRequestError(
      'Unique constraint failed on platform_rule_change_one_waiting',
      { clientVersion: 'test', code: 'P2002' },
    );
    const racing = new Proxy(prisma, {
      get: (target, key, receiver) =>
        key === '$transaction'
          ? () => Promise.reject(clash)
          : Reflect.get(target, key, receiver),
    });
    const service = new PlatformRuleChangesService(
      racing,
      new AuditService(),
      outbox,
      notifications,
      { production: false, webUrl: WEB },
    );

    const res = await refusal(
      service.request(ioana, { key: REVIEWS, reason: 'Testăm recenziile.' }),
    );

    expect(res).toMatchObject({ code: 'change_pending', status: 409 });
  });

  it('keeps one of two simultaneous requests and refuses the other as pending', async () => {
    const results = await Promise.allSettled([ask(ioana), ask(mihai)]);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const [lost] = results.filter((r) => r.status === 'rejected');
    expect(
      ((lost as PromiseRejectedResult).reason as HttpException).getResponse(),
    ).toMatchObject({ code: 'change_pending' });
    expect(await stored()).toHaveLength(1);
  });

  it('writes the request entry with the asker, both values and the reason', async () => {
    const asked = await ask(ioana);

    const [entry] = await entries();
    expect(entry).toMatchObject({
      action: 'create',
      actorId: ioana.accountId,
      field: 'value',
      kind: 'platform_rule.change_requested',
      newValue: false,
      oldValue: true,
      subjectId: asked.id,
      subjectType: 'platform_rule_change',
      text: 'Testăm recenziile din profil.',
    });
  });

  it('records the request event for the admins only, in the same step', async () => {
    const asked = await ask(ioana);

    const [event] = await events();
    expect(event).toMatchObject({
      audience: ['admin'],
      kind: 'platform_rule.change_requested',
      payload: { id: asked.id, key: REVIEWS, status: 'requested' },
      subjectId: asked.id,
    });
  });
});

describe('telling the other admins', () => {
  it('queues one alert per other admin, none for the asker and none twice', async () => {
    await ask(ioana);

    const sent = await alerts();
    expect(sent.map((n) => n.accountId).sort()).toEqual(
      [mihai.accountId, elena.accountId].sort(),
    );
  });

  it('carries the asker, the rule, the reason and the Setări link', async () => {
    const notify = jest.fn().mockResolvedValue(2);

    await changes(false, { notify }).request(ioana, {
      key: REVIEWS,
      reason: '<b>Test</b> recenzii',
    });

    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify.mock.calls[0][0]).toMatchObject({
      kind: 'ADMIN_RULE_APPROVAL_NEEDED',
      params: {
        brief: 'Ioana: <b>Test</b> recenzii',
        name: 'Ioana',
        reason: '<b>Test</b> recenzii',
        settings: `${WEB}/app/admin/settings`,
      },
    });
    expect([...notify.mock.calls[0][0].recipients].sort()).toEqual(
      [mihai.accountId, elena.accountId].sort(),
    );
  });

  it('keeps the push text short whatever the reason', async () => {
    const notify = jest.fn().mockResolvedValue(2);

    await changes(false, { notify }).request(ioana, {
      key: REVIEWS,
      reason: 'a'.repeat(300),
    });

    expect(notify.mock.calls[0][0].params.brief.length).toBeLessThanOrEqual(
      120,
    );
    expect(notify.mock.calls[0][0].params.reason).toHaveLength(300);
  });

  it('cuts the push text between characters, never inside an emoji', async () => {
    const notify = jest.fn().mockResolvedValue(2);

    await changes(false, { notify }).request(ioana, {
      key: REVIEWS,
      reason: '😀'.repeat(200),
    });

    const { brief } = notify.mock.calls[0][0].params;
    expect([...brief]).toHaveLength(120);
    expect(brief).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
    expect(brief.endsWith('😀…')).toBe(true);
  });

  it('tells no one when the asker is the only admin', async () => {
    await prisma.accountRole.deleteMany({
      where: {
        accountId: { in: [mihai.accountId, elena.accountId] },
        role: 'admin',
      },
    });

    await ask(ioana);

    expect(await alerts()).toHaveLength(0);
  });

  it('tells no one on a decision or a withdrawal', async () => {
    const first = await ask(ioana);
    const notify = jest.fn().mockResolvedValue(0);
    await changes(false, { notify }).refuse(mihai, first.id);
    const second = await ask(ioana);
    await changes(false, { notify }).cancel(ioana, second.id);
    const third = await ask(ioana);
    await changes(false, { notify }).approve(mihai, third.id);

    expect(notify).not.toHaveBeenCalled();
  });

  it('keeps the request when the alert cannot be queued', async () => {
    const notify = jest.fn().mockRejectedValue(new Error('queue down'));

    const asked = await changes(false, { notify }).request(ioana, {
      key: REVIEWS,
      reason: 'Testăm recenziile.',
    });

    expect(asked.status).toBe('requested');
    expect(await stored()).toHaveLength(1);
  });
});

describe('deciding a request', () => {
  it('turns the rule off on approval, with the approver as its last changer', async () => {
    const asked = await ask(ioana);

    const decided = await changes().approve(mihai, asked.id);

    expect(decided).toMatchObject({
      decidedByName: 'Mihai',
      mine: false,
      status: 'approved',
    });
    expect(decided.decidedAt).toEqual(expect.any(String));
    const rule = await reviews();
    expect(rule.value).toBe(false);
    expect(rule.updatedBy).toBe(mihai.accountId);
  });

  it('leaves the rule on when another admin refuses', async () => {
    const asked = await ask(ioana);

    const decided = await changes().refuse(mihai, asked.id);

    expect(decided).toMatchObject({
      decidedByName: 'Mihai',
      status: 'refused',
    });
    expect((await reviews()).value).toBe(true);
  });

  it.each(['approve', 'refuse'] as const)(
    'refuses the asker who tries to %s with 403 own_request',
    async (step) => {
      const asked = await ask(ioana);

      const res = await refusal(changes()[step](ioana, asked.id));

      expect(res).toMatchObject({ code: 'own_request', status: 403 });
      expect((await reviews()).value).toBe(true);
    },
  );

  it('answers 409 already_decided naming who decided and how', async () => {
    const asked = await ask(ioana);
    await changes().approve(mihai, asked.id);

    const res = await refusal(changes().refuse(elena, asked.id));

    expect(res).toMatchObject({ code: 'already_decided', status: 409 });
    expect(res.detail).toContain('Mihai');
    expect(res.detail).toContain('approved');
  });

  it.each(['approve', 'refuse', 'cancel'] as const)(
    'answers 404 to %s an unknown request',
    async (step) => {
      const res = await refusal(
        changes()[step](mihai, '00000000-0000-4000-8000-000000000000'),
      );

      expect(res).toMatchObject({ code: 'not_found', status: 404 });
    },
  );

  it('saves exactly one of two simultaneous decisions', async () => {
    const asked = await ask(ioana);

    const results = await Promise.allSettled([
      changes().approve(mihai, asked.id),
      changes().refuse(elena, asked.id),
    ]);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const [row] = await stored();
    const won = (
      results.find((r) => r.status === 'fulfilled') as never as {
        value: { status: string };
      }
    ).value.status;
    expect(row.status).toBe(won);
    expect((await reviews()).value).toBe(won !== 'approved');
  });

  it('writes the decision entry, the rule entry and both events on approval', async () => {
    const asked = await ask(ioana);

    await changes().approve(mihai, asked.id);

    const [, decision, change] = await entries();
    expect(decision).toMatchObject({
      action: 'update',
      actorId: mihai.accountId,
      field: 'status',
      newValue: 'approved',
      oldValue: 'requested',
      subjectId: asked.id,
      subjectType: 'platform_rule_change',
    });
    expect(change).toMatchObject({
      actorId: mihai.accountId,
      kind: 'platform_rule_changed',
      newValue: false,
      oldValue: true,
      subjectType: 'platform_rule',
    });
    expect((await events()).map((e) => [e.kind, e.payload])).toEqual([
      [
        'platform_rule.change_requested',
        { id: asked.id, key: REVIEWS, status: 'requested' },
      ],
      [
        'platform_rule.change_decided',
        { id: asked.id, key: REVIEWS, status: 'approved' },
      ],
      ['platform_rule.changed', { key: REVIEWS, new: false, old: true }],
    ]);
  });

  it('writes one decision entry and one event on a refusal', async () => {
    const asked = await ask(ioana);

    await changes().refuse(mihai, asked.id);

    expect(await entries()).toHaveLength(2);
    expect((await events()).map((e) => e.kind)).toEqual([
      'platform_rule.change_requested',
      'platform_rule.change_decided',
    ]);
  });

  it('writes nothing for a refused call', async () => {
    const asked = await ask(ioana);
    const before = [(await entries()).length, (await events()).length];

    await refusal(changes().approve(ioana, asked.id));
    await refusal(changes().cancel(mihai, asked.id));
    await refusal(ask(mihai));
    await refusal(changes().request(mihai, { key: REVIEWS, reason: 'abc' }));

    expect([(await entries()).length, (await events()).length]).toEqual(before);
  });
});

describe('withdrawing a request', () => {
  it('lets the asker withdraw, recorded as its decider', async () => {
    const asked = await ask(ioana);

    const withdrawn = await changes().cancel(ioana, asked.id);

    expect(withdrawn).toMatchObject({
      decidedByName: 'Ioana',
      mine: true,
      status: 'cancelled',
    });
    expect((await reviews()).value).toBe(true);
  });

  it('refuses another admin with 403 not_requester', async () => {
    const asked = await ask(ioana);

    const res = await refusal(changes().cancel(mihai, asked.id));

    expect(res).toMatchObject({ code: 'not_requester', status: 403 });
  });

  it('answers 409 already_decided once the request was refused', async () => {
    const asked = await ask(ioana);
    await changes().refuse(mihai, asked.id);

    const res = await refusal(changes().cancel(ioana, asked.id));

    expect(res).toMatchObject({ code: 'already_decided', status: 409 });
    expect(res.detail).toContain('Mihai');
  });

  it('says a withdrawn request was withdrawn, by whom', async () => {
    const asked = await ask(ioana);
    await changes().cancel(ioana, asked.id);

    const res = await refusal(changes().approve(mihai, asked.id));

    expect(res).toMatchObject({ code: 'already_decided', status: 409 });
    expect(res.detail).toBe('Already withdrawn by Ioana');
  });
});

describe("listing a rule's requests", () => {
  it('lists the waiting one and the last five others, newest decision first', async () => {
    const decided: string[] = [];
    for (let i = 0; i < 6; i++) {
      const asked = await ask(ioana, `Motivul numărul ${i}`);
      await changes().refuse(mihai, asked.id);
      decided.push(asked.id);
    }
    const waiting = await ask(elena);

    const list = await changes().list(ioana, REVIEWS);

    expect(list.waiting).toMatchObject({ id: waiting.id, mine: false });
    expect(list.decided.map((d) => d.id)).toEqual(decided.slice(1).reverse());
  });

  it('marks the requests the caller asked as theirs', async () => {
    await ask(ioana);

    expect((await changes().list(ioana, REVIEWS)).waiting?.mine).toBe(true);
    expect((await changes().list(mihai, REVIEWS)).waiting?.mine).toBe(false);
  });

  it('answers an empty list for a rule with no requests', async () => {
    expect(await changes().list(ioana, REVIEWS)).toEqual({
      decided: [],
      waiting: null,
    });
  });

  it('refuses an unknown rule and a test-only one in production with 404', async () => {
    expect((await refusal(changes().list(ioana, 'no_such_rule'))).status).toBe(
      404,
    );
    expect(
      (await refusal(changes(true).list(ioana, 'skip_rar_check'))).status,
    ).toBe(404);
  });
});

describe('the review policy', () => {
  it('answers job_only while the rule is on and profile_allowed after an approval', async () => {
    expect(await rules().reviewPolicy()).toEqual({ mode: 'job_only' });

    const asked = await ask(ioana);
    await changes().approve(mihai, asked.id);

    expect(await rules().reviewPolicy()).toEqual({
      mode: 'profile_allowed',
      source: 'profile',
    });
  });
});

describe('the direct change', () => {
  it('still refuses to switch the rule off, and one admin may switch it back on', async () => {
    const res = await refusal(
      rules().change(ioana, REVIEWS, { seen: true, value: false }),
    );
    expect(res).toMatchObject({ code: 'two_admins_required', status: 409 });

    const asked = await ask(ioana);
    await changes().approve(mihai, asked.id);
    const back = await rules().change(ioana, REVIEWS, {
      seen: false,
      value: true,
    });

    expect(back.value).toBe(true);
  });
});
