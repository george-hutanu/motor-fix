import { randomUUID } from 'node:crypto';

import { ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { StaffInviteService } from './staff-invite.service';
import { foreignEntries } from '../../audit/audit.testing';
import { signAccessToken } from '../../auth/access-token';
import { AuthModule } from '../../auth/auth.module';
import type { Role } from '../../auth/capabilities';
import { serialDatabase } from '../../auth/serial-db.testing';
import { BrevoMock } from '../../notifications/brevo/brevo-mock.testing';
import { NotificationsModule } from '../../notifications/notifications.module';
import {
  databaseUrl,
  fixtures,
  redisUrlFor,
  testConfig,
} from '../../notifications/notifications.testing';
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

beforeAll(async () => {
  await brevo.start();
  email = testConfig(brevo.url);
  const auth = AuthModule.register({ databaseUrl, redisUrl, tokenSecret });
  const notifications = NotificationsModule.register(
    { databaseUrl, email, redisUrl },
    auth,
  );
  const moduleRef = await Test.createTestingModule({
    imports: [
      auth,
      notifications,
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

// Atelier Dinamo with its owner Mihai (Romanian), a receptionist and a
// mechanic; Atelier Nord with its owner and a mechanic.
async function world() {
  const dinamo = await prisma.garage.create({
    data: { name: 'Atelier Dinamo', slug: `dinamo-${randomUUID()}` },
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
  prisma.outboxEvent.findMany({ where: { createdAt: { gte: since }, kind } });
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
    expect(owner.body.code).toBe('already_in_team');
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
  it('names the garage, the kind and the invitee without a session', async () => {
    const { token } = await invited();

    const res = await check(token);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      email: 'elena@example.test',
      garage: 'Atelier Dinamo',
      kind: 'mechanic',
      name: 'Elena Stan',
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
