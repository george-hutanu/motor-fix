// @traces 1379-FR-003
import { randomUUID } from 'node:crypto';

import type { Role } from '@motor-fix/contracts/capabilities';
import { ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { StaffInviteService } from './staff-invite.service';
import { foreignEntries } from '../../audit/audit.testing';
import { signAccessToken } from '../../auth/access-token';
import { AuthModule } from '../../auth/auth.module';
import { serialDatabase, waitingOnLocks } from '../../auth/serial-db.testing';
import { outboxMark } from '../../events/outbox.testing';
import { BrevoMock } from '../../notifications/brevo/brevo-mock.testing';
import { DirectSendModule } from '../../notifications/direct-send/direct-send.module';
import { NotificationsModule } from '../../notifications/notifications.module';
import {
  databaseUrl,
  fixtures,
  redisUrlFor,
  testConfig,
  testPhone,
  testPhoneConfig,
} from '../../notifications/notifications.testing';
import { UNUSED_STORAGE } from '../../storage/s3-test-store';
import { StorageModule } from '../../storage/storage.module';
import { GaragesModule } from '../garages.module';

const redisUrl = redisUrlFor(1);
const tokenSecret = 'test-secret';
const DAY = 24 * 60 * 60 * 1000;
const { account, prisma, reset } = fixtures();
serialDatabase(databaseUrl);

const brevo = new BrevoMock();
let app: NestExpressApplication;
let invites: StaffInviteService;
let email: ReturnType<typeof testConfig>;
// The history and the outbox are never emptied: each test reads its own.
let since: Date;
let mark: bigint;

beforeAll(async () => {
  await brevo.start();
  email = testConfig(brevo.url);
  const auth = AuthModule.register({ databaseUrl, redisUrl, tokenSecret });
  const options = {
    databaseUrl,
    email,
    phone: testPhoneConfig({
      WHATSAPP_TEMPLATES:
        'motorfix_staff_invite_ro=31,motorfix_staff_invite_en=32',
    }),
    redisUrl,
  };
  const notifications = NotificationsModule.register(options, auth);
  const moduleRef = await Test.createTestingModule({
    imports: [
      auth,
      notifications,
      DirectSendModule.registerWorker({
        email,
        phone: options.phone,
        redisUrl,
      }),
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
  invites = app.get(StaffInviteService);
});

afterAll(async () => {
  await app.close();
  await brevo.stop();
  await prisma.$disconnect();
});

beforeEach(async () => {
  await reset();
  brevo.reset();
  const [{ now }] = await prisma.$queryRaw<
    { now: Date }[]
  >`SELECT clock_timestamp() AS now`;
  since = now;
  mark = await outboxMark(prisma);
  invites.now = () => new Date();
  await foreignEntries(
    prisma,
    ['invite_sent', 'invite_accepted', 'invite_resent', 'invite_revoked'].map(
      (kind) => ({ kind, subjectType: 'staff_invite' }),
    ),
  );
});

const http = () => request(app.getHttpServer());
const bearer = (accountId: string, role: Role) =>
  `Bearer ${signAccessToken({ accountId, role }, tokenSecret)}`;

// Atelier Dinamo (approved) with its owner Mihai (Romanian), a receptionist
// and a mechanic; Atelier Nord with its owner and a mechanic.
async function world() {
  const dinamo = await prisma.garage.create({
    data: {
      name: 'Atelier Dinamo',
      slug: `dinamo-${randomUUID()}`,
      status: 'approved',
    },
  });
  const nord = await prisma.garage.create({
    data: { name: 'Atelier Nord', slug: `nord-${randomUUID()}` },
  });
  const mihai = await account('mihai', ['garage'], { language: 'ro' });
  await prisma.garageMember.create({
    data: { accountId: mihai, garageId: dinamo.id, role: 'owner' },
  });
  const ioana = await account('ioana', ['receptionist']);
  await prisma.garageMember.create({
    data: { accountId: ioana, garageId: dinamo.id, role: 'receptionist' },
  });
  const vlad = await account('vlad', ['mechanic']);
  await prisma.mechanic.create({
    data: { accountId: vlad, garageId: dinamo.id, name: 'Mecanic' },
  });
  const radu = await account('radu', ['garage'], { language: 'en' });
  await prisma.garageMember.create({
    data: { accountId: radu, garageId: nord.id, role: 'owner' },
  });
  const sorin = await account('sorin', ['mechanic']);
  const sorinRow = await prisma.mechanic.create({
    data: {
      accountId: sorin,
      canMoveBookings: true,
      garageId: nord.id,
      name: 'Mecanic',
    },
  });
  return { dinamo, ioana, mihai, nord, radu, sorin, sorinRow, vlad };
}

const elena = {
  email: 'elena@example.test',
  kind: 'mechanic',
  name: 'Elena Stan',
};

const send = (
  garageId: string,
  auth: string,
  body: Record<string, unknown> = elena,
) =>
  http()
    .post(`/garages/${garageId}/invites`)
    .set('Authorization', auth)
    .send(body);
const resend = (garageId: string, id: string, auth: string) =>
  http()
    .post(`/garages/${garageId}/invites/${id}/resend`)
    .set('Authorization', auth);
const revoke = (garageId: string, id: string, auth: string) =>
  http()
    .post(`/garages/${garageId}/invites/${id}/revoke`)
    .set('Authorization', auth);
const check = (token: unknown) => http().post('/invites/check').send({ token });
const accept = (token: unknown, auth?: string) => {
  const call = http().post('/invites/accept').send({ token });
  return auth ? call.set('Authorization', auth) : call;
};

// The token of the last e-mail Brevo was asked to send.
function tokenOf() {
  const mail = brevo.emails().at(-1);
  if (!mail) throw new Error('no e-mail sent');
  const { textContent: text } = mail.body as { textContent: string };
  const match = /\/(ro|en)\/invite\/([A-Za-z0-9_-]+)/.exec(text);
  if (!match) throw new Error('no invite link in the e-mail');
  return { language: match[1], token: match[2] };
}

const outbox = (kind: string) =>
  prisma.outboxEvent.findMany({ where: { id: { gt: mark }, kind } });
const audit = (kind: string, garageId: string) =>
  prisma.activityLog.findMany({
    where: { at: { gte: since }, garageId, kind, subjectType: 'staff_invite' },
  });

async function features(garageId: string, enabled: boolean) {
  await prisma.garageFeature.create({
    data: { enabled, garageId, key: 'team_mechanics' },
  });
}

describe('sending an invite', () => {
  // @traces 131-FR-001 131-FR-004
  it('stores the invite and e-mails the link in the owner language', async () => {
    const { dinamo, mihai } = await world();

    const res = await send(dinamo.id, bearer(mihai, 'garage'), {
      ...elena,
      canAnswerQuotes: true,
      email: '  Elena@Example.test ',
    });

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ emailSent: true, id: expect.any(String) });
    const row = await prisma.staffInvite.findUniqueOrThrow({
      where: { id: res.body.id },
    });
    expect(row).toMatchObject({
      canAnswerQuotes: true,
      canMoveBookings: false,
      canRecordFinalPrice: false,
      email: 'elena@example.test',
      garageId: dinamo.id,
      kind: 'mechanic',
      name: 'Elena Stan',
      status: 'sent',
    });
    const ttl = row.expiresAt.getTime() - Date.now();
    expect(ttl).toBeGreaterThan(7 * DAY - 60_000);
    expect(ttl).toBeLessThanOrEqual(7 * DAY);
    expect(brevo.emails()).toHaveLength(1);
    const body = brevo.emails()[0].body as { to: { email: string }[] };
    expect(body.to[0].email).toBe('elena@example.test');
    expect(tokenOf().language).toBe('ro');
    expect(row.tokenHash).not.toContain(tokenOf().token);
  });

  // @traces 131-FR-001
  it('stores a receptionist invite with every permission off', async () => {
    const { dinamo, mihai } = await world();

    const res = await send(dinamo.id, bearer(mihai, 'garage'), {
      ...elena,
      canMoveBookings: true,
      kind: 'receptionist',
    });

    expect(res.status).toBe(201);
    const row = await prisma.staffInvite.findUniqueOrThrow({
      where: { id: res.body.id },
    });
    expect(row.kind).toBe('receptionist');
    expect(row.canMoveBookings).toBe(false);
  });

  // @traces 131-FR-010
  it('audits the send without the address and records invite.sent', async () => {
    const { dinamo, mihai } = await world();

    const res = await send(dinamo.id, bearer(mihai, 'garage'));

    const [entry] = await audit('invite_sent', dinamo.id);
    expect(entry).toMatchObject({
      actorId: mihai,
      garageId: dinamo.id,
      subjectId: res.body.id,
    });
    expect(JSON.stringify(entry.newValue)).not.toContain('elena@');
    expect(entry.newValue).toMatchObject({
      kind: 'mechanic',
      permissions: {
        canAnswerQuotes: false,
        canMoveBookings: false,
        canRecordFinalPrice: false,
      },
    });
    const [event] = await outbox('invite.sent');
    expect(event).toMatchObject({
      audience: [`garage:${dinamo.id}`],
      subjectId: res.body.id,
    });
  });

  // @traces 131-FR-004
  it('keeps the invite and answers the link when the e-mail is refused', async () => {
    const { dinamo, mihai } = await world();
    brevo.answer({ body: { code: 'invalid_parameter' }, status: 400 });

    const res = await send(dinamo.id, bearer(mihai, 'garage'));

    expect(res.status).toBe(201);
    expect(res.body.emailSent).toBe(false);
    expect(res.body.link).toMatch(
      /^https:\/\/motorfix\.test\/ro\/invite\/[A-Za-z0-9_-]{43}$/,
    );
    const token = res.body.link.split('/').at(-1);
    expect((await check(token)).status).toBe(200);
    const row = await prisma.staffInvite.findUniqueOrThrow({
      where: { id: res.body.id },
    });
    expect(row.status).toBe('sent');
  });

  // @traces 1379-FR-003
  it('keeps the invite and answers the link when e-mail sending is off', async () => {
    const { dinamo, mihai } = await world();
    email.sending = false;
    try {
      const res = await send(dinamo.id, bearer(mihai, 'garage'));

      expect(res.status).toBe(201);
      expect(res.body.emailSent).toBe(false);
      expect(res.body.link).toMatch(
        /^https:\/\/motorfix\.test\/ro\/invite\/[A-Za-z0-9_-]{43}$/,
      );
      expect(brevo.emails()).toHaveLength(0);
      const row = await prisma.staffInvite.findUniqueOrThrow({
        where: { id: res.body.id },
      });
      expect(row.status).toBe('sent');
    } finally {
      email.sending = true;
    }
  });

  it('stores nothing and sends nothing while the web address is not set', async () => {
    const { dinamo, mihai } = await world();
    const { webUrl } = email;
    email.webUrl = undefined;
    try {
      const res = await send(dinamo.id, bearer(mihai, 'garage'));

      expect(res.status).toBe(500);
      expect(await prisma.staffInvite.count()).toBe(0);
      expect(brevo.emails()).toHaveLength(0);
    } finally {
      email.webUrl = webUrl;
    }
  });

  it.each([
    ['its receptionist', 'ioana', 'receptionist'],
    ['its mechanic', 'vlad', 'mechanic'],
  ] as const)('answers 403 to %s', async (_, who, role) => {
    const w = await world();

    const res = await send(w.dinamo.id, bearer(w[who], role));

    expect(res.status).toBe(403);
    expect(await prisma.staffInvite.count()).toBe(0);
  });

  // @traces 131-FR-002
  it("answers 404 to another garage's owner and to a driver", async () => {
    const { dinamo, radu } = await world();
    const driver = await account('dan', ['driver']);

    expect((await send(dinamo.id, bearer(radu, 'garage'))).status).toBe(404);
    expect((await send(dinamo.id, bearer(driver, 'driver'))).status).toBe(404);
    expect(brevo.emails()).toHaveLength(0);
  });

  it('answers 401 without a session', async () => {
    const { dinamo } = await world();

    const res = await http().post(`/garages/${dinamo.id}/invites`).send(elena);

    expect(res.status).toBe(401);
  });

  // @traces 131-FR-003
  it('refuses a second open invite to the same address with its id', async () => {
    const { dinamo, mihai } = await world();
    const first = await send(dinamo.id, bearer(mihai, 'garage'));

    const res = await send(dinamo.id, bearer(mihai, 'garage'), {
      ...elena,
      email: 'ELENA@example.test',
    });

    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({
      code: 'invite_open',
      inviteId: first.body.id,
    });
    expect(brevo.emails()).toHaveLength(1);
  });

  it('lets an expired invite be followed by a new one', async () => {
    const { dinamo, mihai } = await world();
    await send(dinamo.id, bearer(mihai, 'garage'));
    invites.now = () => new Date(Date.now() + 8 * DAY);

    const res = await send(dinamo.id, bearer(mihai, 'garage'));

    expect(res.status).toBe(201);
  });

  // @traces 131-FR-003
  // @traces 1255-FR-004
  it('refuses a person who already holds that kind at the garage, and the owner himself', async () => {
    const { dinamo, mihai } = await world();

    const mechanic = await send(dinamo.id, bearer(mihai, 'garage'), {
      ...elena,
      email: 'vlad@example.test',
    });
    const receptionist = await send(dinamo.id, bearer(mihai, 'garage'), {
      ...elena,
      email: 'ioana@example.test',
      kind: 'receptionist',
    });
    const owner = await send(dinamo.id, bearer(mihai, 'garage'), {
      ...elena,
      email: 'mihai@example.test',
      kind: 'receptionist',
    });

    expect(mechanic.status).toBe(409);
    expect(mechanic.body.code).toBe('already_in_team');
    expect(receptionist.body.code).toBe('already_in_team');
    expect(owner.status).toBe(409);
    expect(owner.body.code).toBe('self_invite');
  });

  it('lets the receptionist of the garage be invited as its mechanic', async () => {
    const { dinamo, mihai } = await world();

    const res = await send(dinamo.id, bearer(mihai, 'garage'), {
      ...elena,
      email: 'ioana@example.test',
    });

    expect(res.status).toBe(201);
  });

  // @traces 131-FR-014
  it('answers 400 to a body that breaks the rules', async () => {
    const { dinamo, mihai } = await world();

    const res = await send(dinamo.id, bearer(mihai, 'garage'), {
      ...elena,
      name: 'E',
    });

    expect(res.status).toBe(400);
  });
});

describe('opening and accepting a link', () => {
  async function invited(kind: 'mechanic' | 'receptionist' = 'mechanic') {
    const w = await world();
    const res = await send(w.dinamo.id, bearer(w.mihai, 'garage'), {
      ...elena,
      canRecordFinalPrice: true,
      kind,
    });
    return { ...w, id: res.body.id as string, token: tokenOf().token };
  }

  // @traces 131-FR-006
  // @traces 1255-FR-009
  it('names the garage, the kind and the invitee without a session', async () => {
    const { token } = await invited();

    const res = await check(token);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      email: 'elena@example.test',
      garage: 'Atelier Dinamo',
      kind: 'mechanic',
      leaving: null,
      name: 'Elena Stan',
      phone: null,
    });
  });

  // @traces 131-FR-006
  it('answers the same for an unknown, a malformed and a revoked link', async () => {
    const { dinamo, id, mihai, token } = await invited();
    await revoke(dinamo.id, id, bearer(mihai, 'garage'));

    const answers = await Promise.all(
      [token, 'A'.repeat(43), 'not a token'].map(check),
    );

    for (const res of answers) {
      expect(res.status).toBe(410);
      expect(res.body.code).toBe('invite_invalid');
    }
  });

  // @traces 131-FR-006 131-FR-007
  it('answers invite_expired after 7 days', async () => {
    const { token } = await invited();
    invites.now = () => new Date(Date.now() + 7 * DAY + 1000);

    const opened = await check(token);
    const someone = await account('ana', ['driver']);
    const accepted = await accept(token, bearer(someone, 'driver'));

    expect(opened.status).toBe(410);
    expect(opened.body.code).toBe('invite_expired');
    expect(accepted.body.code).toBe('invite_expired');
  });

  it('answers 401 to an accept without a session', async () => {
    const { token } = await invited();

    expect((await accept(token)).status).toBe(401);
  });

  // @traces 131-FR-007 131-FR-009 131-FR-010
  it('makes a driver a mechanic of the garage, keeping the driver role', async () => {
    const { dinamo, id, mihai, token } = await invited();
    const ana = await account('ana', ['driver']);

    const res = await accept(token, bearer(ana, 'driver'));

    expect(res.status).toBe(204);
    const roles = await prisma.accountRole.findMany({
      where: { accountId: ana },
    });
    expect(roles.map((r) => r.role).sort()).toEqual(['driver', 'mechanic']);
    const row = await prisma.mechanic.findUniqueOrThrow({
      where: { accountId: ana },
    });
    expect(row).toMatchObject({
      canAnswerQuotes: false,
      canMoveBookings: false,
      canRecordFinalPrice: true,
      garageId: dinamo.id,
    });
    const invite = await prisma.staffInvite.findUniqueOrThrow({
      where: { id },
    });
    expect(invite.status).toBe('accepted');
    const [entry] = await audit('invite_accepted', dinamo.id);
    expect(entry).toMatchObject({ actorId: ana, garageId: dinamo.id });
    const [event] = await outbox('invite.accepted');
    expect(event.audience).toEqual([`garage:${dinamo.id}`]);
    const joined = await prisma.notification.findMany({
      where: { accountId: mihai, kind: 'STAFF_JOINED' },
    });
    expect(joined.map((n) => n.channel).sort()).toEqual(['email', 'in_app']);
  });

  // @traces 055-FR-004 055-FR-016
  it('lists one row for a person whose old card was detached and who accepts a new invite', async () => {
    const { dinamo, mihai, token } = await invited();
    await prisma.mechanic.create({
      data: { garageId: dinamo.id, name: 'Elena Stan', removedAt: new Date() },
    });
    const ana = await account('ana', ['driver']);

    expect((await accept(token, bearer(ana, 'driver'))).status).toBe(204);

    const res = await http()
      .get(`/garages/${dinamo.id}/mechanics`)
      .set('Authorization', bearer(mihai, 'garage'));
    expect(
      res.body.items.map(({ hasAccount, name }: Record<string, unknown>) => ({
        hasAccount,
        name,
      })),
    ).toEqual([
      { hasAccount: true, name: 'Elena Stan' },
      { hasAccount: true, name: 'Mecanic' },
    ]);
  });

  it('lets the new mechanic act in the garage as a mechanic', async () => {
    const { dinamo, token } = await invited();
    const ana = await account('ana', ['driver']);
    await accept(token, bearer(ana, 'driver'));

    const res = await http()
      .get('/audit-history')
      .set('Authorization', bearer(ana, 'mechanic'));

    expect(res.status).toBe(200);
    const mechanic = await prisma.mechanic.findUniqueOrThrow({
      where: { accountId: ana },
    });
    expect(mechanic.garageId).toBe(dinamo.id);
  });

  it('takes the role from the invite, never from the body', async () => {
    const { token } = await invited('receptionist');
    const ana = await account('ana', ['driver']);

    const res = await http()
      .post('/invites/accept')
      .set('Authorization', bearer(ana, 'driver'))
      .send({ role: 'admin', token });

    expect(res.status).toBe(400);
    const roles = await prisma.accountRole.findMany({
      where: { accountId: ana },
    });
    expect(roles.map((r) => r.role)).toEqual(['driver']);
  });

  // @traces 131-FR-007
  it('makes a receptionist a member of the garage, with no mechanic row', async () => {
    const { dinamo, token } = await invited('receptionist');
    const ana = await account('ana', ['driver']);

    const res = await accept(token, bearer(ana, 'driver'));

    expect(res.status).toBe(204);
    const member = await prisma.garageMember.findUniqueOrThrow({
      where: { garageId_accountId: { accountId: ana, garageId: dinamo.id } },
    });
    expect(member.role).toBe('receptionist');
    expect(await prisma.mechanic.count({ where: { accountId: ana } })).toBe(0);
  });

  // @traces 131-FR-007 131-FR-009
  it('moves a mechanic of another garage at once, with the new permissions', async () => {
    const { dinamo, nord, sorin, sorinRow, token } = await invited();

    const res = await accept(token, bearer(sorin, 'mechanic'));

    expect(res.status).toBe(204);
    const row = await prisma.mechanic.findUniqueOrThrow({
      where: { id: sorinRow.id },
    });
    expect(row).toMatchObject({
      canMoveBookings: false,
      canRecordFinalPrice: true,
      garageId: dinamo.id,
    });
    const [moved] = await outbox('mechanic.updated');
    expect(moved.subjectId).toBe(sorinRow.id);
    expect(moved.audience).toEqual([
      `garage:${dinamo.id}`,
      `garage:${nord.id}`,
    ]);
  });

  // @traces 131-FR-007
  it('accepts once when one link is accepted twice at the same time', async () => {
    const { token } = await invited();
    const ana = await account('ana', ['driver']);
    const dan = await account('dan', ['driver']);

    const answers = await Promise.all([
      accept(token, bearer(ana, 'driver')),
      accept(token, bearer(dan, 'driver')),
    ]);

    expect(answers.map((r) => r.status).sort()).toEqual([204, 410]);
    // Vlad, Sorin and the one who won.
    expect(await prisma.mechanic.count()).toBe(3);
  });

  it('refuses a used link', async () => {
    const { token } = await invited();
    const ana = await account('ana', ['driver']);
    await accept(token, bearer(ana, 'driver'));

    const again = await check(token);

    expect(again.status).toBe(410);
    expect(again.body.code).toBe('invite_invalid');
  });

  // @traces 056-FR-015
  it("refuses another garage's owner, whose own row never moves", async () => {
    const { id, nord, radu, token } = await invited();
    const own = await prisma.mechanic.create({
      data: { accountId: radu, garageId: nord.id, isOwner: true, name: 'Radu' },
    });

    const res = await accept(token, bearer(radu, 'garage'));

    expect(res.status).toBe(410);
    expect(res.body.code).toBe('invite_invalid');
    expect(
      await prisma.mechanic.findUniqueOrThrow({ where: { id: own.id } }),
    ).toMatchObject({ garageId: nord.id, isOwner: true });
    expect(
      (await prisma.staffInvite.findUniqueOrThrow({ where: { id } })).status,
    ).toBe('sent');
  });

  // @traces 131-FR-008
  it("refuses the garage's own owner", async () => {
    const { id, mihai, token } = await invited();

    const res = await accept(token, bearer(mihai, 'garage'));

    expect(res.status).toBe(410);
    expect(res.body.code).toBe('invite_invalid');
    const invite = await prisma.staffInvite.findUniqueOrThrow({
      where: { id },
    });
    expect(invite.status).toBe('sent');
  });

  // @traces 131-FR-008
  it("refuses another garage's receptionist a receptionist invite", async () => {
    const { nord, token } = await invited('receptionist');
    const tudor = await account('tudor', ['receptionist']);
    await prisma.garageMember.create({
      data: { accountId: tudor, garageId: nord.id, role: 'receptionist' },
    });

    const res = await accept(token, bearer(tudor, 'receptionist'));

    expect(res.status).toBe(410);
    expect(res.body.code).toBe('invite_invalid');
  });

  // @traces 131-FR-008
  it('completes with no other change for someone already in that role there', async () => {
    const { id, ioana, token } = await invited('receptionist');

    const res = await accept(token, bearer(ioana, 'receptionist'));

    expect(res.status).toBe(204);
    const invite = await prisma.staffInvite.findUniqueOrThrow({
      where: { id },
    });
    expect(invite.status).toBe('accepted');
  });

  // @traces 131-FR-008
  it("keeps a mechanic's own permissions when he accepts a link to his own garage", async () => {
    const { id, token, vlad } = await invited('mechanic');

    const res = await accept(token, bearer(vlad, 'mechanic'));

    expect(res.status).toBe(204);
    const row = await prisma.mechanic.findUniqueOrThrow({
      where: { accountId: vlad },
    });
    expect(row.canRecordFinalPrice).toBe(false);
    expect(await outbox('mechanic.updated')).toHaveLength(0);
    const invite = await prisma.staffInvite.findUniqueOrThrow({
      where: { id },
    });
    expect(invite.status).toBe('accepted');
  });
});

describe('resending and revoking', () => {
  async function sent() {
    const w = await world();
    const res = await send(w.dinamo.id, bearer(w.mihai, 'garage'));
    return { ...w, id: res.body.id as string, token: tokenOf().token };
  }

  // @traces 131-FR-005
  it('sends a new link, voids the old one and restarts the 7 days', async () => {
    const { dinamo, id, mihai, token } = await sent();
    invites.now = () => new Date(Date.now() + 8 * DAY);

    const res = await resend(dinamo.id, id, bearer(mihai, 'garage'));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ emailSent: true, id });
    const fresh = tokenOf().token;
    expect(fresh).not.toBe(token);
    expect((await check(token)).body.code).toBe('invite_invalid');
    expect((await check(fresh)).status).toBe(200);
    const [entry] = await audit('invite_resent', dinamo.id);
    expect(entry?.newValue).toEqual({
      kind: 'mechanic',
      name: 'Elena Stan',
      permissions: {
        canAnswerQuotes: false,
        canMoveBookings: false,
        canRecordFinalPrice: false,
      },
    });
  });

  it('keeps the old link working when a resend finds the web address unset', async () => {
    const { dinamo, id, mihai, token } = await sent();
    const { webUrl } = email;
    email.webUrl = undefined;
    try {
      const res = await resend(dinamo.id, id, bearer(mihai, 'garage'));

      expect(res.status).toBe(500);
      expect(brevo.emails()).toHaveLength(1);
      expect((await check(token)).status).toBe(200);
    } finally {
      email.webUrl = webUrl;
    }
  });

  // @traces 131-FR-005 131-FR-010
  it('stops the link on revoke and records it', async () => {
    const { dinamo, id, mihai, token } = await sent();

    const res = await revoke(dinamo.id, id, bearer(mihai, 'garage'));

    expect(res.status).toBe(204);
    expect((await check(token)).body.code).toBe('invite_invalid');
    expect(await audit('invite_revoked', dinamo.id)).toHaveLength(1);
    const [event] = await outbox('invite.revoked');
    expect(event.subjectId).toBe(id);
  });

  // @traces 131-FR-005
  it('answers 409 invite_invalid for a revoked or accepted invite', async () => {
    const { dinamo, id, mihai } = await sent();
    await revoke(dinamo.id, id, bearer(mihai, 'garage'));

    const again = await revoke(dinamo.id, id, bearer(mihai, 'garage'));
    const resent = await resend(dinamo.id, id, bearer(mihai, 'garage'));

    expect(again.status).toBe(409);
    expect(again.body.code).toBe('invite_invalid');
    expect(resent.status).toBe(409);
  });

  // @traces 131-FR-002
  it('answers 403 to the staff and 404 to another owner and to another garage id', async () => {
    const { dinamo, id, ioana, nord, radu } = await sent();

    expect(
      (await revoke(dinamo.id, id, bearer(ioana, 'receptionist'))).status,
    ).toBe(403);
    expect((await resend(dinamo.id, id, bearer(radu, 'garage'))).status).toBe(
      404,
    );
    expect((await revoke(nord.id, id, bearer(radu, 'garage'))).status).toBe(
      404,
    );
  });
});

describe('a garage with its team switched off', () => {
  // @traces 131-FR-003
  it('refuses a mechanic invite with feature_off and still sends a receptionist one', async () => {
    const { dinamo, mihai } = await world();
    await features(dinamo.id, false);

    const mechanic = await send(dinamo.id, bearer(mihai, 'garage'));
    const receptionist = await send(dinamo.id, bearer(mihai, 'garage'), {
      ...elena,
      kind: 'receptionist',
    });

    expect(mechanic.status).toBe(404);
    expect(mechanic.body.code).toBe('feature_off');
    expect(receptionist.status).toBe(201);
  });

  // @traces 131-FR-006 131-FR-008
  it('answers feature_off to opening and accepting a mechanic link sent before', async () => {
    const { dinamo, mihai } = await world();
    const sentRes = await send(dinamo.id, bearer(mihai, 'garage'));
    const { token } = tokenOf();
    await features(dinamo.id, false);
    const ana = await account('ana', ['driver']);

    const opened = await check(token);
    const accepted = await accept(token, bearer(ana, 'driver'));

    expect(opened.status).toBe(404);
    expect(opened.body.code).toBe('feature_off');
    expect(accepted.status).toBe(404);
    expect(accepted.body.code).toBe('feature_off');
    const invite = await prisma.staffInvite.findUniqueOrThrow({
      where: { id: sentRes.body.id },
    });
    expect(invite.status).toBe('sent');
  });

  it('treats a switch that is on like a missing one', async () => {
    const { dinamo, mihai } = await world();
    await features(dinamo.id, true);

    expect((await send(dinamo.id, bearer(mihai, 'garage'))).status).toBe(201);
  });
});

// Elena's card at a garage: saved by the owner, with no account yet.
function card(
  garageId: string,
  extra: { accountId?: string; isOwner?: boolean; removedAt?: Date } = {},
) {
  return prisma.mechanic.create({
    data: {
      garageId,
      name: 'Elena Stan',
      roleTitle: 'Electrician auto',
      specialties: ['Electrică'],
      years: 6,
      ...extra,
    },
  });
}

// The token of the last WhatsApp message Brevo was asked to send.
function whatsappToken() {
  const body = brevo.whatsapp().at(-1)?.body as
    | { params: string[] }
    | undefined;
  const link = body?.params.find((param) => param.includes('/invite/'));
  if (!link) throw new Error('no invite link in the WhatsApp message');
  return link.split('/').at(-1) as string;
}

const listed = async (garageId: string, auth: string, mechanicId: string) => {
  const res = await http()
    .get(`/garages/${garageId}/mechanics`)
    .set('Authorization', auth);
  return res.body.items.find((item: { id: string }) => item.id === mechanicId);
};

const phoneOf = (accountId: string, phone: string) =>
  prisma.account.update({ data: { phone }, where: { id: accountId } });

describe('sending an invite from a card', () => {
  // @traces 1255-FR-001 1255-FR-002
  it("stores the card with the card's name and the permissions off, and e-mails the link", async () => {
    const { dinamo, mihai } = await world();
    const elenaCard = await card(dinamo.id);

    const res = await send(dinamo.id, bearer(mihai, 'garage'), {
      email: 'elena@example.test',
      kind: 'mechanic',
      mechanicId: elenaCard.id,
    });

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ emailSent: true, id: expect.any(String) });
    const row = await prisma.staffInvite.findUniqueOrThrow({
      where: { id: res.body.id },
    });
    expect(row).toMatchObject({
      canAnswerQuotes: false,
      canMoveBookings: false,
      canRecordFinalPrice: false,
      email: 'elena@example.test',
      kind: 'mechanic',
      mechanicId: elenaCard.id,
      name: 'Elena Stan',
      phone: null,
      status: 'sent',
    });
    expect(brevo.emails()).toHaveLength(1);
  });

  // @traces 1255-FR-001 1255-FR-005
  it('sends the link by WhatsApp to a phone, in the owner language, never by SMS', async () => {
    const { dinamo, mihai } = await world();
    const elenaCard = await card(dinamo.id);

    const res = await send(dinamo.id, bearer(mihai, 'garage'), {
      kind: 'mechanic',
      mechanicId: elenaCard.id,
      phone: '0710 000 001',
    });

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ emailSent: true, id: expect.any(String) });
    const row = await prisma.staffInvite.findUniqueOrThrow({
      where: { id: res.body.id },
    });
    expect(row).toMatchObject({ email: null, phone: testPhone(1) });
    expect(brevo.whatsapp().map((call) => call.body)).toEqual([
      {
        contactNumbers: ['40710000001'],
        params: [
          'Atelier Dinamo',
          expect.stringMatching(
            /^https:\/\/motorfix\.test\/ro\/invite\/[A-Za-z0-9_-]{43}$/,
          ),
        ],
        senderNumber: '40700000099',
        templateId: 31,
      },
    ]);
    expect(brevo.sms()).toHaveLength(0);
    expect(brevo.emails()).toHaveLength(0);
    expect((await check(whatsappToken())).status).toBe(200);
  });

  // @traces 1255-FR-005
  it.each([
    ['the number is not allowed outside production', '+40722999999', false],
    ['the provider refuses the message', testPhone(1), true],
  ])(
    'keeps the invite and answers the link when %s',
    async (_, phone, refused) => {
      const { dinamo, mihai } = await world();
      const elenaCard = await card(dinamo.id);
      if (refused)
        brevo.answer({ body: { code: 'invalid_parameter' }, status: 400 });

      const res = await send(dinamo.id, bearer(mihai, 'garage'), {
        kind: 'mechanic',
        mechanicId: elenaCard.id,
        phone,
      });

      expect(res.status).toBe(201);
      expect(res.body.emailSent).toBe(false);
      expect(res.body.link).toMatch(
        /^https:\/\/motorfix\.test\/ro\/invite\/[A-Za-z0-9_-]{43}$/,
      );
      expect((await check(res.body.link.split('/').at(-1))).status).toBe(200);
      expect(brevo.sms()).toHaveLength(0);
      const row = await prisma.staffInvite.findUniqueOrThrow({
        where: { id: res.body.id },
      });
      expect(row.status).toBe('sent');
    },
  );

  // @traces 1255-FR-003
  it("refuses the owner's row, a card with an account, and a card already invited", async () => {
    const { dinamo, mihai, vlad } = await world();
    const ownerRow = await card(dinamo.id, { accountId: mihai, isOwner: true });
    const vladCard = await prisma.mechanic.findUniqueOrThrow({
      where: { accountId: vlad },
    });
    const elenaCard = await card(dinamo.id);
    const to = (mechanicId: string, address = 'elena@example.test') =>
      send(dinamo.id, bearer(mihai, 'garage'), {
        email: address,
        kind: 'mechanic',
        mechanicId,
      });
    const first = await to(elenaCard.id);

    const owner = await to(ownerRow.id);
    const linked = await to(vladCard.id);
    const open = await to(elenaCard.id, 'elena.stan@example.test');

    expect([owner.status, owner.body.code]).toEqual([409, 'owner_row']);
    expect([linked.status, linked.body.code]).toEqual([409, 'card_linked']);
    expect(open.status).toBe(409);
    expect(open.body).toMatchObject({
      code: 'invite_open',
      inviteId: first.body.id,
    });
    expect(brevo.emails()).toHaveLength(1);
  });

  // @traces 1255-FR-003
  it("answers 404 for another garage's card and a removed card", async () => {
    const { dinamo, mihai, sorinRow } = await world();
    const removed = await card(dinamo.id, { removedAt: new Date() });

    for (const mechanicId of [sorinRow.id, removed.id, randomUUID()]) {
      const res = await send(dinamo.id, bearer(mihai, 'garage'), {
        email: 'elena@example.test',
        kind: 'mechanic',
        mechanicId,
      });
      expect([res.status, res.body.code]).toEqual([404, 'not_found']);
    }
    expect(await prisma.staffInvite.count()).toBe(0);
  });

  // @traces 1255-FR-003
  it("revokes the card's expired invite when a new one is sent", async () => {
    const { dinamo, mihai } = await world();
    const elenaCard = await card(dinamo.id);
    const body = {
      email: 'elena@example.test',
      kind: 'mechanic',
      mechanicId: elenaCard.id,
    };
    const old = await send(dinamo.id, bearer(mihai, 'garage'), body);
    invites.now = () => new Date(Date.now() + 8 * DAY);

    const res = await send(dinamo.id, bearer(mihai, 'garage'), {
      ...body,
      email: 'elena.stan@example.test',
    });

    expect(res.status).toBe(201);
    const rows = await prisma.staffInvite.findMany({
      orderBy: { createdAt: 'asc' },
    });
    expect(rows.map(({ id, status }) => ({ id, status }))).toEqual([
      { id: old.body.id, status: 'revoked' },
      { id: res.body.id, status: 'sent' },
    ]);
  });

  // @traces 1255-FR-004
  it("refuses the owner's own phone, compared normalised", async () => {
    const { dinamo, mihai } = await world();
    await phoneOf(mihai, testPhone(2));
    const elenaCard = await card(dinamo.id);

    const res = await send(dinamo.id, bearer(mihai, 'garage'), {
      kind: 'mechanic',
      mechanicId: elenaCard.id,
      phone: '0710 000 002',
    });

    expect([res.status, res.body.code]).toEqual([409, 'self_invite']);
    expect(brevo.whatsapp()).toHaveLength(0);
  });

  // @traces 1255-FR-003
  it('refuses by phone a person who is already a mechanic here', async () => {
    const { dinamo, mihai, vlad } = await world();
    await phoneOf(vlad, testPhone(3));

    const res = await send(dinamo.id, bearer(mihai, 'garage'), {
      kind: 'mechanic',
      name: 'Vlad',
      phone: testPhone(3),
    });

    expect([res.status, res.body.code]).toEqual([409, 'already_in_team']);
  });

  // @traces 1255-FR-002
  it('answers 400 to both an e-mail and a phone, and to a card for a receptionist', async () => {
    const { dinamo, mihai } = await world();
    const elenaCard = await card(dinamo.id);

    const both = await send(dinamo.id, bearer(mihai, 'garage'), {
      email: 'elena@example.test',
      kind: 'mechanic',
      mechanicId: elenaCard.id,
      phone: testPhone(1),
    });
    const receptionist = await send(dinamo.id, bearer(mihai, 'garage'), {
      email: 'elena@example.test',
      kind: 'receptionist',
      mechanicId: elenaCard.id,
    });

    expect(both.status).toBe(400);
    expect(receptionist.status).toBe(400);
    expect(await prisma.staffInvite.count()).toBe(0);
  });

  // @traces 1255-FR-018
  it("answers 403 to the garage's staff, 404 to another owner, and feature_off", async () => {
    const { dinamo, ioana, mihai, radu } = await world();
    const elenaCard = await card(dinamo.id);
    const body = {
      email: 'elena@example.test',
      kind: 'mechanic',
      mechanicId: elenaCard.id,
    };

    const staff = await send(dinamo.id, bearer(ioana, 'receptionist'), body);
    const other = await send(dinamo.id, bearer(radu, 'garage'), body);
    await features(dinamo.id, false);
    const off = await send(dinamo.id, bearer(mihai, 'garage'), body);

    expect(staff.status).toBe(403);
    expect(other.status).toBe(404);
    expect([off.status, off.body.code]).toEqual([404, 'feature_off']);
    expect(await prisma.staffInvite.count()).toBe(0);
  });
});

describe('accepting an invite from a card', () => {
  async function invited(body: Record<string, unknown> = {}) {
    const w = await world();
    const elenaCard = await card(w.dinamo.id);
    const res = await send(w.dinamo.id, bearer(w.mihai, 'garage'), {
      canAnswerQuotes: true,
      email: 'elena@example.test',
      kind: 'mechanic',
      mechanicId: elenaCard.id,
      ...body,
    });
    return {
      ...w,
      elenaCard,
      id: res.body.id as string,
      token: body['phone'] ? whatsappToken() : tokenOf().token,
    };
  }

  // @traces 059-FR-011 059-FR-009
  it('turns the consent on but tells no public channel while the garage hides its team', async () => {
    const { dinamo, elenaCard, token } = await invited();
    await prisma.garage.update({
      data: { teamOnProfile: false },
      where: { id: dinamo.id },
    });
    const ana = await account('ana', ['driver']);

    const res = await accept(token, bearer(ana, 'driver'));

    expect(res.status).toBe(204);
    expect(
      (await prisma.mechanic.findUniqueOrThrow({ where: { id: elenaCard.id } }))
        .onProfile,
    ).toBe(true);
    const [linked] = await outbox('mechanic.updated');
    expect(linked.audience).toEqual([
      `garage:${dinamo.id}`,
      `mechanic:${elenaCard.id}`,
    ]);
  });

  // @traces 1255-FR-006 1255-FR-008
  it('links the card to the account, puts it on the profile and keeps its fields', async () => {
    const { dinamo, elenaCard, id, mihai, token } = await invited();
    const ana = await account('ana', ['driver']);

    const res = await accept(token, bearer(ana, 'driver'));

    expect(res.status).toBe(204);
    const row = await prisma.mechanic.findUniqueOrThrow({
      where: { id: elenaCard.id },
    });
    expect(row).toMatchObject({
      accountId: ana,
      canAnswerQuotes: true,
      canMoveBookings: false,
      canRecordFinalPrice: false,
      garageId: dinamo.id,
      name: 'Elena Stan',
      onProfile: true,
      roleTitle: 'Electrician auto',
      specialties: ['Electrică'],
      years: 6,
    });
    expect(
      await prisma.mechanic.count({ where: { garageId: dinamo.id } }),
    ).toBe(2);
    const roles = await prisma.accountRole.findMany({
      where: { accountId: ana },
    });
    expect(roles.map((r) => r.role).sort()).toEqual(['driver', 'mechanic']);
    expect(
      (await prisma.staffInvite.findUniqueOrThrow({ where: { id } })).status,
    ).toBe('accepted');
    const [linked] = await outbox('mechanic.updated');
    expect(linked).toMatchObject({
      payload: expect.objectContaining({
        fields: ['account'],
        mechanicId: elenaCard.id,
      }),
      subjectId: elenaCard.id,
    });
    expect(linked.audience).toEqual(
      expect.arrayContaining([
        `garage:${dinamo.id}`,
        `public:garage:${dinamo.id}`,
        `public:mechanic:${elenaCard.id}`,
      ]),
    );
    expect(await outbox('invite.accepted')).toHaveLength(1);
    const [entry] = await audit('invite_accepted', dinamo.id);
    expect(entry).toMatchObject({ field: 'status', oldValue: 'sent' });
    expect(entry.newValue).toEqual({
      kind: 'mechanic',
      mechanicId: elenaCard.id,
      name: 'Elena Stan',
      permissions: {
        canAnswerQuotes: true,
        canMoveBookings: false,
        canRecordFinalPrice: false,
      },
    });
    const joined = await prisma.notification.findMany({
      where: { accountId: mihai, kind: 'STAFF_JOINED' },
    });
    expect(joined.length).toBeGreaterThan(0);
  });

  // @traces 1255-FR-006
  it('refuses a mechanic of another garage with move_required, changing nothing', async () => {
    const { elenaCard, id, nord, sorin, sorinRow, token } = await invited();

    const res = await accept(token, bearer(sorin, 'mechanic'));

    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({
      code: 'move_required',
      garage: 'Atelier Nord',
    });
    expect(
      await prisma.mechanic.findUniqueOrThrow({ where: { id: elenaCard.id } }),
    ).toMatchObject({ accountId: null, onProfile: false });
    expect(
      await prisma.mechanic.findUniqueOrThrow({ where: { id: sorinRow.id } }),
    ).toMatchObject({ garageId: nord.id });
    expect(
      (await prisma.staffInvite.findUniqueOrThrow({ where: { id } })).status,
    ).toBe('sent');
    expect(await outbox('mechanic.updated')).toHaveLength(0);
  });

  // @traces 1255-FR-006
  it('answers invite_invalid for a card removed after the send', async () => {
    const removedCase = await invited();
    await prisma.mechanic.update({
      data: { removedAt: new Date() },
      where: { id: removedCase.elenaCard.id },
    });
    const ana = await account('ana', ['driver']);

    const removed = await accept(removedCase.token, bearer(ana, 'driver'));

    expect([removed.status, removed.body.code]).toEqual([
      410,
      'invite_invalid',
    ]);
    expect(await prisma.mechanic.count({ where: { accountId: ana } })).toBe(0);
  });

  // @traces 1255-FR-006
  it('answers invite_invalid to an account that already has a row at the garage', async () => {
    const { elenaCard, id, token, vlad } = await invited();

    const res = await accept(token, bearer(vlad, 'mechanic'));

    expect([res.status, res.body.code]).toEqual([410, 'invite_invalid']);
    expect(
      await prisma.mechanic.findUniqueOrThrow({ where: { id: elenaCard.id } }),
    ).toMatchObject({ accountId: null });
    expect(
      (await prisma.staffInvite.findUniqueOrThrow({ where: { id } })).status,
    ).toBe('sent');
  });

  // @traces 1255-FR-009
  it('names the phone, and the garage a signed-in mechanic would leave', async () => {
    const { sorin, token } = await invited({
      email: undefined,
      phone: testPhone(1),
    });
    const ana = await account('ana', ['driver']);

    const anonymous = await check(token);
    const driver = await check(token).set(
      'Authorization',
      bearer(ana, 'driver'),
    );
    const leaving = await check(token).set(
      'Authorization',
      bearer(sorin, 'mechanic'),
    );

    expect(anonymous.status).toBe(200);
    expect(anonymous.body).toEqual({
      email: null,
      garage: 'Atelier Dinamo',
      kind: 'mechanic',
      leaving: null,
      name: 'Elena Stan',
      phone: testPhone(1),
    });
    expect(driver.body.leaving).toBeNull();
    expect(leaving.body.leaving).toBe('Atelier Nord');
  });
});

describe('resending, revoking and expiry from a card', () => {
  async function byPhone() {
    const w = await world();
    const elenaCard = await card(w.dinamo.id);
    const res = await send(w.dinamo.id, bearer(w.mihai, 'garage'), {
      kind: 'mechanic',
      mechanicId: elenaCard.id,
      phone: testPhone(1),
    });
    return {
      ...w,
      elenaCard,
      id: res.body.id as string,
      token: whatsappToken(),
    };
  }

  // @traces 1255-FR-005
  it('resends by WhatsApp and voids the old link', async () => {
    const { dinamo, id, mihai, token } = await byPhone();

    const res = await resend(dinamo.id, id, bearer(mihai, 'garage'));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ emailSent: true, id });
    expect(brevo.whatsapp()).toHaveLength(2);
    expect(brevo.emails()).toHaveLength(0);
    const fresh = whatsappToken();
    expect(fresh).not.toBe(token);
    expect((await check(token)).body.code).toBe('invite_invalid');
    expect((await check(fresh)).status).toBe(200);
  });

  // @traces 1255-FR-011
  it("clears the card's invite on revoke", async () => {
    const { dinamo, elenaCard, id, mihai } = await byPhone();
    const auth = bearer(mihai, 'garage');
    expect((await listed(dinamo.id, auth, elenaCard.id)).invite).toMatchObject({
      email: null,
      id,
      phone: testPhone(1),
    });

    expect((await revoke(dinamo.id, id, auth)).status).toBe(204);

    expect((await listed(dinamo.id, auth, elenaCard.id)).invite).toBeNull();
  });

  // @traces 1255-FR-011
  it('lists an expired invite with its date and refuses to accept it', async () => {
    const { dinamo, elenaCard, id, mihai, token } = await byPhone();
    invites.now = () => new Date(Date.now() + 8 * DAY);
    const ana = await account('ana', ['driver']);

    const res = await accept(token, bearer(ana, 'driver'));

    expect([res.status, res.body.code]).toEqual([410, 'invite_expired']);
    const { invite } = await listed(
      dinamo.id,
      bearer(mihai, 'garage'),
      elenaCard.id,
    );
    expect(invite.id).toBe(id);
    expect(new Date(invite.expiresAt).getTime()).toBeLessThan(
      invites.now().getTime(),
    );
  });
});

describe('two accepts for one account at the same time', () => {
  // @traces 1255-FR-007
  it('records each move from the garage the row was really in', async () => {
    const { dinamo, mihai, nord, sorin, sorinRow } = await world();
    const sud = await prisma.garage.create({
      data: { name: 'Atelier Sud', slug: `sud-${randomUUID()}` },
    });
    const ilie = await account('ilie', ['garage']);
    await prisma.garageMember.create({
      data: { accountId: ilie, garageId: sud.id, role: 'owner' },
    });
    await send(dinamo.id, bearer(mihai, 'garage'));
    const toDinamo = tokenOf().token;
    await send(sud.id, bearer(ilie, 'garage'));
    const toSud = tokenOf().token;

    // Holding the row makes both accepts reach it before either moves it.
    let answers: Promise<request.Response[]> | undefined;
    await prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM mechanic WHERE id = ${sorinRow.id}::uuid FOR UPDATE`;
        answers = Promise.all([
          accept(toDinamo, bearer(sorin, 'mechanic')),
          accept(toSud, bearer(sorin, 'mechanic')),
        ]);
        await waitingOnLocks(prisma, 2);
      },
      { timeout: 20_000 },
    );

    expect((await answers)?.map((r) => r.status)).toEqual([204, 204]);
    const moves = (await outbox('mechanic.updated')).map(
      (event) => event.payload as { from: string; garageId: string },
    );
    expect(moves).toHaveLength(2);
    const first = moves.find((move) => move.from === nord.id);
    const second = moves.find((move) => move !== first);
    expect(second?.from).toBe(first?.garageId);
    const row = await prisma.mechanic.findUniqueOrThrow({
      where: { id: sorinRow.id },
    });
    expect(row.garageId).toBe(second?.garageId);
  });

  // @traces 1255-FR-006
  it('answers invite_invalid, never a 500, to the second of two card links taken by an account with no row', async () => {
    const { dinamo, mihai } = await world();
    const first = await card(dinamo.id);
    const second = await card(dinamo.id);
    await send(dinamo.id, bearer(mihai, 'garage'), {
      email: 'elena@example.test',
      kind: 'mechanic',
      mechanicId: first.id,
    });
    const toFirst = tokenOf().token;
    await send(dinamo.id, bearer(mihai, 'garage'), {
      email: 'elena2@example.test',
      kind: 'mechanic',
      mechanicId: second.id,
    });
    const toSecond = tokenOf().token;
    // Already a mechanic by role, so the grant does not line the two up.
    const ana = await account('ana', ['mechanic']);

    // Holding both cards makes both accepts pass the row check before
    // either links its card.
    let answers: Promise<request.Response[]> | undefined;
    await prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM mechanic WHERE id IN (${first.id}::uuid, ${second.id}::uuid) FOR UPDATE`;
        answers = Promise.all([
          accept(toFirst, bearer(ana, 'mechanic')),
          accept(toSecond, bearer(ana, 'mechanic')),
        ]);
        await waitingOnLocks(prisma, 2);
      },
      { timeout: 20_000 },
    );

    const out = (await answers) ?? [];
    expect(out.map((r) => r.status).sort()).toEqual([204, 410]);
    expect(out.find((r) => r.status === 410)?.body.code).toBe('invite_invalid');
    expect(await prisma.mechanic.count({ where: { accountId: ana } })).toBe(1);
  });
});
