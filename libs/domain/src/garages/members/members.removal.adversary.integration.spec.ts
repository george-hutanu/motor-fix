import { randomUUID } from 'node:crypto';

import type { Role } from '@motor-fix/contracts/capabilities';
import { ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { signAccessToken } from '../../auth/access-token';
import { AuthModule } from '../../auth/auth.module';
import { serialDatabase } from '../../auth/serial-db.testing';
import { outboxMark } from '../../events/outbox.testing';
import { BrevoMock } from '../../notifications/brevo/brevo-mock.testing';
import { NotificationsModule } from '../../notifications/notifications.module';
import {
  databaseUrl,
  fixtures,
  redisUrlFor,
  testConfig,
} from '../../notifications/notifications.testing';
import { UNUSED_STORAGE } from '../../storage/s3-test-store';
import { StorageModule } from '../../storage/storage.module';
import { GaragesModule } from '../garages.module';

const redisUrl = redisUrlFor(1);
const tokenSecret = 'test-secret';
const { account, prisma, reset } = fixtures();
serialDatabase(databaseUrl);

const brevo = new BrevoMock();
let app: NestExpressApplication;

beforeAll(async () => {
  await brevo.start();
  const email = testConfig(brevo.url);
  const auth = AuthModule.register({ databaseUrl, redisUrl, tokenSecret });
  const notifications = NotificationsModule.register(
    { databaseUrl, email, redisUrl },
    auth,
  );
  const moduleRef = await Test.createTestingModule({
    imports: [
      auth,
      notifications,
      StorageModule.register(UNUSED_STORAGE),
      GaragesModule.register(email, notifications, {
        skipManualApproval: false,
      }),
    ],
  }).compile();
  app = moduleRef.createNestApplication<NestExpressApplication>();
  app.useGlobalPipes(
    new ValidationPipe({
      forbidNonWhitelisted: true,
      transform: true,
      whitelist: true,
    }),
  );
  await app.init();
});

afterAll(async () => {
  await app.close();
  await brevo.stop();
  await prisma.$disconnect();
});

let mark: bigint;

beforeEach(async () => {
  await reset();
  brevo.reset();
  mark = await outboxMark(prisma);
});

const DAY = 86_400_000;

const bearer = (accountId: string, role: Role) =>
  `Bearer ${signAccessToken({ accountId, role }, tokenSecret)}`;
const remove = (garageId: string, accountId: string, auth?: string) => {
  const call = request(app.getHttpServer()).delete(
    `/garages/${garageId}/members/${accountId}`,
  );
  return auth ? call.set('Authorization', auth) : call;
};
const outbox = (kind: string) =>
  prisma.outboxEvent.findMany({ where: { id: { gt: mark }, kind } });
const audits = (garageId: string) =>
  prisma.activityLog.findMany({
    where: { garageId, subjectType: 'member' },
  });
const rows = (garageId: string) =>
  prisma.garageMember.count({ where: { garageId } });

async function world() {
  const g = await prisma.garage.create({
    data: { name: 'Dinamo', slug: `dinamo-${randomUUID()}` },
  });
  const owner = await account('owner', ['garage']);
  await prisma.garageMember.create({
    data: { accountId: owner, garageId: g.id, role: 'owner' },
  });
  const desk = await account('desk', ['receptionist']);
  await prisma.garageMember.create({
    data: { accountId: desk, garageId: g.id, role: 'receptionist' },
  });
  return { desk, garage: g, owner };
}

const invite = (
  garageId: string,
  data: {
    email?: string;
    phone?: string;
    kind?: 'mechanic' | 'receptionist';
    status?: 'sent' | 'accepted' | 'revoked';
  },
) =>
  prisma.staffInvite.create({
    data: {
      expiresAt: new Date(Date.now() + 7 * DAY),
      garageId,
      kind: 'receptionist',
      name: 'Invited Person',
      tokenHash: randomUUID(),
      ...data,
    },
  });
const status = async (id: string) =>
  (await prisma.staffInvite.findUniqueOrThrow({ where: { id } })).status;

// @traces 400-FR-001
describe('the removal route under odd requests', () => {
  it('ignores a body and a query string and still answers 204', async () => {
    const w = await world();

    const res = await remove(w.garage.id, w.desk, bearer(w.owner, 'garage'))
      .query({ force: 'true' })
      .send({ accountId: randomUUID(), role: 'owner' });

    expect(res.status).toBe(204);
    expect(await rows(w.garage.id)).toBe(1);
  });

  it('answers 404 for a missing account segment and removes nobody', async () => {
    const w = await world();

    const bare = await request(app.getHttpServer())
      .delete(`/garages/${w.garage.id}/members`)
      .set('Authorization', bearer(w.owner, 'garage'));
    const slash = await request(app.getHttpServer())
      .delete(`/garages/${w.garage.id}/members/`)
      .set('Authorization', bearer(w.owner, 'garage'));

    expect([bare.status, slash.status]).toEqual([404, 404]);
    expect(await rows(w.garage.id)).toBe(2);
  });

  it('answers 400 for an encoded space, an empty-looking id and a uuid with a suffix', async () => {
    const w = await world();

    const answers = [
      await remove(w.garage.id, `${w.desk}%20`, bearer(w.owner, 'garage')),
      await remove(w.garage.id, `${w.desk}x`, bearer(w.owner, 'garage')),
      await remove(w.garage.id, '%00', bearer(w.owner, 'garage')),
      await remove(w.garage.id, 'ünï-çödé', bearer(w.owner, 'garage')),
    ];

    expect(answers.map((r) => r.status)).toEqual([400, 400, 400, 400]);
    expect(await rows(w.garage.id)).toBe(2);
  });

  it('answers 404 to an owner who also drives when she signs in with the driver token', async () => {
    const w = await world();
    await prisma.accountRole.create({
      data: { accountId: w.owner, role: 'driver' },
    });

    const res = await remove(w.garage.id, w.desk, bearer(w.owner, 'driver'));

    expect([res.status, res.body.code]).toEqual([404, 'not_found']);
    expect(await rows(w.garage.id)).toBe(2);
  });

  it('answers 401 for a forged token even on a valid pair of ids', async () => {
    const w = await world();

    const res = await remove(w.garage.id, w.desk, 'Bearer forged.token.here');

    expect([res.status, res.body.code]).toEqual([401, 'sign_in_required']);
    expect(await rows(w.garage.id)).toBe(2);
  });
});

// @traces 400-FR-001
describe('refusals write nothing', () => {
  it('leaves no audit entry, event or notice after a 404, a 409, a 403 and a 400', async () => {
    const w = await world();
    const stranger = await account('stranger', ['driver']);
    const fixer = await account('fixer', ['mechanic']);
    await prisma.mechanic.create({
      data: { accountId: fixer, garageId: w.garage.id, name: 'Fixer' },
    });

    const answers = [
      await remove(w.garage.id, fixer, bearer(w.owner, 'garage')),
      await remove(w.garage.id, randomUUID(), bearer(w.owner, 'garage')),
      await remove(w.garage.id, w.owner, bearer(w.owner, 'garage')),
      await remove(w.garage.id, w.desk, bearer(fixer, 'mechanic')),
      await remove(w.garage.id, w.desk, bearer(stranger, 'driver')),
      await remove(w.garage.id, 'nope', bearer(w.owner, 'garage')),
    ];

    expect(answers.map((r) => r.status)).toEqual([
      404, 404, 409, 403, 404, 400,
    ]);
    expect(answers[2].body.code).toBe('owner_row');
    expect(await audits(w.garage.id)).toEqual([]);
    expect(await outbox('member.removed')).toEqual([]);
    expect(
      await prisma.notification.count({ where: { kind: 'STAFF_REMOVED' } }),
    ).toBe(0);
    expect(await rows(w.garage.id)).toBe(2);
  });

  it('keeps the mechanic card and its row when her account number is given', async () => {
    const w = await world();
    const fixer = await account('fixer', ['mechanic']);
    const card = await prisma.mechanic.create({
      data: { accountId: fixer, garageId: w.garage.id, name: 'Fixer' },
    });

    await remove(w.garage.id, fixer, bearer(w.owner, 'garage'));

    const after = await prisma.mechanic.findUniqueOrThrow({
      where: { id: card.id },
    });
    expect(after.removedAt).toBeNull();
    expect(after.accountId).toBe(fixer);
  });
});

// @traces 400-FR-002
describe('what the removal touches and leaves alone', () => {
  it('removes only the named receptionist and keeps the owner, the other desk and her own account', async () => {
    const w = await world();
    const other = await account('other desk', ['receptionist']);
    await prisma.garageMember.create({
      data: { accountId: other, garageId: w.garage.id, role: 'receptionist' },
    });

    const res = await remove(w.garage.id, w.desk, bearer(w.owner, 'garage'));

    expect(res.status).toBe(204);
    const left = await prisma.garageMember.findMany({
      orderBy: { role: 'asc' },
      where: { garageId: w.garage.id },
    });
    expect(left.map((m) => [m.accountId, m.role]).sort()).toEqual(
      [
        [w.owner, 'owner'],
        [other, 'receptionist'],
      ].sort(),
    );
    expect(await prisma.account.count({ where: { id: w.desk } })).toBe(1);
  });

  it('revokes invites to her e-mail whatever the case on either side, and leaves accepted and revoked ones as they were', async () => {
    const w = await world();
    await prisma.account.update({
      data: { email: 'Ioana.Marin@Example.TEST' },
      where: { id: w.desk },
    });
    const upper = await invite(w.garage.id, {
      email: 'IOANA.MARIN@EXAMPLE.TEST',
    });
    const lower = await invite(w.garage.id, {
      email: 'ioana.marin@example.test',
    });
    const second = await invite(w.garage.id, {
      email: 'ioana.marin@example.test',
    });
    const accepted = await invite(w.garage.id, {
      email: 'ioana.marin@example.test',
      status: 'accepted',
    });
    const revoked = await invite(w.garage.id, {
      email: 'ioana.marin@example.test',
      status: 'revoked',
    });
    const lookalike = await invite(w.garage.id, {
      email: 'ioana.marin@example.test.ro',
    });
    const prefix = await invite(w.garage.id, {
      email: 'xioana.marin@example.test',
    });

    await remove(w.garage.id, w.desk, bearer(w.owner, 'garage'));

    expect({
      accepted: await status(accepted.id),
      lookalike: await status(lookalike.id),
      lower: await status(lower.id),
      prefix: await status(prefix.id),
      revoked: await status(revoked.id),
      second: await status(second.id),
      upper: await status(upper.id),
    }).toEqual({
      accepted: 'accepted',
      lookalike: 'sent',
      lower: 'revoked',
      prefix: 'sent',
      revoked: 'revoked',
      second: 'revoked',
      upper: 'revoked',
    });
  });

  it('treats an e-mail with SQL wildcards as plain text', async () => {
    const w = await world();
    await prisma.account.update({
      data: { email: 'a_b%@example.test' },
      where: { id: w.desk },
    });
    const wild = await invite(w.garage.id, { email: 'axbyz@example.test' });
    const exact = await invite(w.garage.id, { email: 'A_B%@example.test' });

    await remove(w.garage.id, w.desk, bearer(w.owner, 'garage'));

    expect([await status(wild.id), await status(exact.id)]).toEqual([
      'sent',
      'revoked',
    ]);
  });

  it('revokes nothing by phone when her account has none, and nothing by e-mail when the invite has only a phone', async () => {
    const w = await world();
    await prisma.account.update({
      data: { email: 'desk@example.test', phone: null },
      where: { id: w.desk },
    });
    const phoneOnly = await invite(w.garage.id, { phone: '+40722000999' });
    const mine = await invite(w.garage.id, { email: 'desk@example.test' });

    await remove(w.garage.id, w.desk, bearer(w.owner, 'garage'));

    expect([await status(phoneOnly.id), await status(mine.id)]).toEqual([
      'sent',
      'revoked',
    ]);
  });

  it('keeps invites to her address at other garages and of the mechanic kind', async () => {
    const w = await world();
    const other = await prisma.garage.create({
      data: { name: 'Nord', slug: `nord-${randomUUID()}` },
    });
    await prisma.account.update({
      data: { email: 'desk@example.test' },
      where: { id: w.desk },
    });
    const elsewhere = await invite(other.id, { email: 'desk@example.test' });
    const mechanic = await invite(w.garage.id, {
      email: 'desk@example.test',
      kind: 'mechanic',
    });

    await remove(w.garage.id, w.desk, bearer(w.owner, 'garage'));

    expect([await status(elsewhere.id), await status(mechanic.id)]).toEqual([
      'sent',
      'sent',
    ]);
  });

  it('keeps her name verbatim, markup and unicode included, in the audit entry', async () => {
    const w = await world();
    const name = '<img src=x onerror=1> Ștefănița "Ț" ñ';
    await prisma.account.update({ data: { name }, where: { id: w.desk } });

    await remove(w.garage.id, w.desk, bearer(w.owner, 'garage'));

    const [entry] = await audits(w.garage.id);
    expect(entry.oldValue).toEqual({ name, role: 'receptionist' });
  });

  it('keeps the audit entries she wrote herself, with her name', async () => {
    const w = await world();
    await prisma.activityLog.create({
      data: {
        action: 'update',
        actorId: w.desk,
        actorName: 'desk',
        actorRole: 'receptionist',
        garageId: w.garage.id,
        subjectId: w.garage.id,
        subjectType: 'garage',
      },
    });

    await remove(w.garage.id, w.desk, bearer(w.owner, 'garage'));

    const hers = await prisma.activityLog.findMany({
      where: { actorId: w.desk, subjectType: 'garage' },
    });
    expect(hers).toEqual([
      expect.objectContaining({ actorName: 'desk', actorRole: 'receptionist' }),
    ]);
  });
});

// @traces 400-FR-002
describe('removing the same person repeatedly or at once', () => {
  it('writes one entry, one event and one notice set across a 204 and a repeated 404', async () => {
    const w = await world();

    const first = await remove(w.garage.id, w.desk, bearer(w.owner, 'garage'));
    const second = await remove(w.garage.id, w.desk, bearer(w.owner, 'garage'));
    const third = await remove(
      w.garage.id,
      w.desk.toUpperCase(),
      bearer(w.owner, 'garage'),
    );

    expect([first.status, second.status, third.status]).toEqual([
      204, 404, 404,
    ]);
    expect(await audits(w.garage.id)).toHaveLength(1);
    expect(await outbox('member.removed')).toHaveLength(1);
    const keys = await prisma.notification.findMany({
      where: { accountId: w.desk, kind: 'STAFF_REMOVED' },
    });
    expect(new Set(keys.map((n) => n.eventId)).size).toBe(1);
  });

  it('ends twelve simultaneous removals in one 204, eleven 404 and one entry, one event', async () => {
    const w = await world();

    const answers = await Promise.all(
      Array.from({ length: 12 }, () =>
        remove(w.garage.id, w.desk, bearer(w.owner, 'garage')),
      ),
    );

    expect(answers.map((r) => r.status).sort()).toEqual(
      [204, ...Array(11).fill(404)].sort(),
    );
    expect(await audits(w.garage.id)).toHaveLength(1);
    expect(await outbox('member.removed')).toHaveLength(1);
  });

  it('removes two different receptionists at once, each with its own entry and event', async () => {
    const w = await world();
    const other = await account('other desk', ['receptionist']);
    await prisma.garageMember.create({
      data: { accountId: other, garageId: w.garage.id, role: 'receptionist' },
    });

    const answers = await Promise.all([
      remove(w.garage.id, w.desk, bearer(w.owner, 'garage')),
      remove(w.garage.id, other, bearer(w.owner, 'garage')),
    ]);

    expect(answers.map((r) => r.status)).toEqual([204, 204]);
    expect((await audits(w.garage.id)).map((a) => a.subjectId).sort()).toEqual(
      [w.desk, other].sort(),
    );
    expect(await outbox('member.removed')).toHaveLength(2);
    expect(await rows(w.garage.id)).toBe(1);
  });

  it('answers a receptionist 403 who removes herself while the owner removal of her still ends 204', async () => {
    const w = await world();

    const [self, owner] = await Promise.all([
      remove(w.garage.id, w.desk, bearer(w.desk, 'receptionist')),
      remove(w.garage.id, w.desk, bearer(w.owner, 'garage')),
    ]);

    expect([self.status, owner.status]).toEqual([403, 204]);
  });
});

// @traces 400-FR-003
describe('a removed receptionist who is invited again', () => {
  it('is removed a second time as a new membership with a new notice key', async () => {
    const w = await world();
    const firstRow = await prisma.garageMember.findUniqueOrThrow({
      where: {
        garageId_accountId: { accountId: w.desk, garageId: w.garage.id },
      },
    });
    await remove(w.garage.id, w.desk, bearer(w.owner, 'garage'));
    await prisma.garageMember.create({
      data: {
        accountId: w.desk,
        garageId: w.garage.id,
        joinedAt: new Date(firstRow.joinedAt.getTime() + 5_000),
        role: 'receptionist',
      },
    });

    const again = await remove(w.garage.id, w.desk, bearer(w.owner, 'garage'));

    expect(again.status).toBe(204);
    const keys = await prisma.notification.findMany({
      where: { accountId: w.desk, kind: 'STAFF_REMOVED' },
    });
    expect(new Set(keys.map((n) => n.eventId)).size).toBe(2);
    expect(await audits(w.garage.id)).toHaveLength(2);
    expect(await outbox('member.removed')).toHaveLength(2);
  });

  it('cannot reach the owner route with her old token and gets 404 on every owner-only read', async () => {
    const w = await world();
    await remove(w.garage.id, w.desk, bearer(w.owner, 'garage'));

    const members = await request(app.getHttpServer())
      .get(`/garages/${w.garage.id}/members`)
      .set('Authorization', bearer(w.desk, 'receptionist'));
    const again = await remove(
      w.garage.id,
      w.owner,
      bearer(w.desk, 'receptionist'),
    );

    expect([members.status, again.status]).toEqual([404, 404]);
    expect(await rows(w.garage.id)).toBe(1);
  });
});

// @traces 400-FR-004
describe('telling the removed receptionist, hostile data', () => {
  it('notifies only her, never the owner, and carries the garage name verbatim', async () => {
    const w = await world();
    const name = '<b>Ștefan & Fii</b> "Auto"';
    await prisma.garage.update({ data: { name }, where: { id: w.garage.id } });

    await remove(w.garage.id, w.desk, bearer(w.owner, 'garage'));

    const sent = await prisma.notification.findMany({
      where: { kind: 'STAFF_REMOVED' },
    });
    expect(sent.length).toBeGreaterThan(0);
    expect(new Set(sent.map((n) => n.accountId))).toEqual(new Set([w.desk]));
    for (const n of sent) expect(n.params).toEqual({ garage: name });
  });
});
