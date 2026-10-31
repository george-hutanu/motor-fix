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

const send = (garageId: string, auth: string, body: Record<string, unknown>) =>
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

const listed = async (garageId: string, auth: string, mechanicId: string) => {
  const res = await http()
    .get(`/garages/${garageId}/mechanics`)
    .set('Authorization', auth);
  return res.body.items.find((item: { id: string }) => item.id === mechanicId);
};

async function cardAndInvite(extra: Record<string, unknown> = {}) {
  const w = await world();
  const elenaCard = await card(w.dinamo.id);
  const res = await send(w.dinamo.id, bearer(w.mihai, 'garage'), {
    email: 'elena@example.test',
    kind: 'mechanic',
    mechanicId: elenaCard.id,
    ...extra,
  });
  return { ...w, elenaCard, res };
}

describe('sending from a card under hostile input', () => {
  it('ignores a name sent beside the card', async () => {
    const { res } = await cardAndInvite({ name: 'Someone Else' });

    expect(res.status).toBe(201);
    const row = await prisma.staffInvite.findUniqueOrThrow({
      where: { id: res.body.id },
    });
    expect(row.name).toBe('Elena Stan');
  });

  it('refuses a second invite to the same card by the same phone typed two ways', async () => {
    const { dinamo, elenaCard, mihai } = await cardAndInvite({
      email: undefined,
      phone: '0710 000 001',
    });

    const again = await send(dinamo.id, bearer(mihai, 'garage'), {
      kind: 'mechanic',
      mechanicId: elenaCard.id,
      phone: testPhone(1),
    });

    expect([again.status, again.body.code]).toEqual([409, 'invite_open']);
    expect(await prisma.staffInvite.count()).toBe(1);
  });

  it('refuses the owner own e-mail typed in capitals', async () => {
    const { dinamo, elenaCard, mihai } = await world().then(async (w) => ({
      ...w,
      elenaCard: await card(w.dinamo.id),
    }));
    const row = await prisma.account.findUniqueOrThrow({
      where: { id: mihai },
    });

    const res = await send(dinamo.id, bearer(mihai, 'garage'), {
      email: ` ${(row.email ?? 'x@x.test').toUpperCase()} `,
      kind: 'mechanic',
      mechanicId: elenaCard.id,
    });

    expect([res.status, res.body.code]).toEqual([409, 'self_invite']);
    expect(brevo.emails()).toHaveLength(0);
  });

  it('answers 400 to a body that carries a token', async () => {
    const { dinamo, elenaCard, mihai } = await world().then(async (w) => ({
      ...w,
      elenaCard: await card(w.dinamo.id),
    }));

    const res = await send(dinamo.id, bearer(mihai, 'garage'), {
      email: 'elena@example.test',
      kind: 'mechanic',
      mechanicId: elenaCard.id,
      token: 'abc',
    });

    expect(res.status).toBe(400);
    expect(await prisma.staffInvite.count()).toBe(0);
  });

  it('answers 400 to a card id that is not a UUID, without touching the store', async () => {
    const { dinamo, mihai } = await world();

    const res = await send(dinamo.id, bearer(mihai, 'garage'), {
      email: 'elena@example.test',
      kind: 'mechanic',
      mechanicId: "1'; DROP TABLE staff_invite;--",
    });

    expect(res.status).toBe(400);
    expect(await prisma.staffInvite.count()).toBe(0);
  });

  it('refuses a card id with a malformed body type', async () => {
    const { dinamo, mihai } = await world();

    const res = await http()
      .post(`/garages/${dinamo.id}/invites`)
      .set('Authorization', bearer(mihai, 'garage'))
      .set('Content-Type', 'text/plain')
      .send('mechanicId');

    expect([400, 415]).toContain(res.status);
  });

  it('keeps one stored invite when two sends for the same card race', async () => {
    const { dinamo, elenaCard, mihai } = await world().then(async (w) => ({
      ...w,
      elenaCard: await card(w.dinamo.id),
    }));
    const go = (address: string) =>
      send(dinamo.id, bearer(mihai, 'garage'), {
        email: address,
        kind: 'mechanic',
        mechanicId: elenaCard.id,
      });

    // Holding the card makes both sends wait on its row lock together, so
    // neither has seen the other's invite before it takes the lock.
    let answers: Promise<request.Response[]> | undefined;
    await prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM mechanic WHERE id = ${elenaCard.id}::uuid FOR UPDATE`;
        answers = Promise.all([go('a1@example.test'), go('a2@example.test')]);
        await waitingOnLocks(prisma, 2);
      },
      { timeout: 20_000 },
    );

    const out = (await answers) ?? [];
    expect(out.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(
      await prisma.staffInvite.count({
        where: { mechanicId: elenaCard.id, status: 'sent' },
      }),
    ).toBe(1);
  });

  it('answers card_linked before invite_open for a linked card with an invite', async () => {
    const { dinamo, mihai, vlad } = await world();
    const vladCard = await prisma.mechanic.findUniqueOrThrow({
      where: { accountId: vlad },
    });
    await prisma.staffInvite.create({
      data: {
        email: 'old@example.test',
        expiresAt: new Date(Date.now() + DAY),
        garageId: dinamo.id,
        kind: 'mechanic',
        mechanicId: vladCard.id,
        name: 'Mecanic',
        tokenHash: randomUUID(),
      },
    });

    const res = await send(dinamo.id, bearer(mihai, 'garage'), {
      email: 'new@example.test',
      kind: 'mechanic',
      mechanicId: vladCard.id,
    });

    expect([res.status, res.body.code]).toEqual([409, 'card_linked']);
  });
});

describe('opening a card link under hostile input', () => {
  it('answers the invite to a malformed bearer, as to no session', async () => {
    const { res } = await cardAndInvite();
    expect(res.status).toBe(201);
    const token = tokenOf().token;

    const out = await check(token).set('Authorization', 'Bearer not.a.token');

    expect([out.status, out.body.leaving]).toEqual([200, null]);
  });

  it('answers invite_invalid to the garage owner opening his own link', async () => {
    const { mihai } = await cardAndInvite();

    const out = await check(tokenOf().token).set(
      'Authorization',
      bearer(mihai, 'garage'),
    );

    expect(out.status).toBe(410);
    expect(out.body.code).toBe('invite_invalid');
  });

  it('names no leaving garage to a mechanic of the invite garage', async () => {
    const { vlad } = await cardAndInvite();

    const out = await check(tokenOf().token).set(
      'Authorization',
      bearer(vlad, 'mechanic'),
    );

    expect([out.status, out.body.leaving]).toEqual([200, null]);
  });

  it.each([
    ['an empty token', ''],
    ['a 257 character token', 'a'.repeat(257)],
    ['a number', 42],
    ['null', null],
  ])('answers 400 to %s', async (_, token) => {
    const out = await check(token);
    expect(out.status).toBe(400);
  });

  it('does not list the token or its hash on the team list', async () => {
    const { dinamo, elenaCard, mihai } = await cardAndInvite();

    const item = await listed(dinamo.id, bearer(mihai, 'garage'), elenaCard.id);

    expect(Object.keys(item.invite).sort()).toEqual([
      'email',
      'expiresAt',
      'id',
      'phone',
      'sentAt',
    ]);
  });
});

describe('accepting a card link under hostile input', () => {
  it('lets only one of two accounts take the same card', async () => {
    const { elenaCard } = await cardAndInvite();
    const token = tokenOf().token;
    const ana = await account('ana', ['driver']);
    const bogdan = await account('bogdan', ['driver']);

    const [a, b] = await Promise.all([
      accept(token, bearer(ana, 'driver')),
      accept(token, bearer(bogdan, 'driver')),
    ]);

    expect([a.status, b.status].sort()).toEqual([204, 410]);
    const linked = await prisma.mechanic.findUniqueOrThrow({
      where: { id: elenaCard.id },
    });
    expect([ana, bogdan]).toContain(linked.accountId);
    expect(
      await prisma.mechanic.count({ where: { garageId: elenaCard.garageId } }),
    ).toBe(2);
  });

  it('answers invite_invalid to a second accept by the same account', async () => {
    await cardAndInvite();
    const token = tokenOf().token;
    const ana = await account('ana', ['driver']);

    const first = await accept(token, bearer(ana, 'driver'));
    const second = await accept(token, bearer(ana, 'driver'));

    expect(first.status).toBe(204);
    expect([second.status, second.body.code]).toEqual([410, 'invite_invalid']);
  });

  it('refuses an accept after the card was linked by hand to another account', async () => {
    const { elenaCard } = await cardAndInvite();
    const token = tokenOf().token;
    const bogdan = await account('bogdan', ['driver']);
    await prisma.mechanic.update({
      data: { accountId: bogdan },
      where: { id: elenaCard.id },
    });
    const ana = await account('ana', ['driver']);

    const out = await accept(token, bearer(ana, 'driver'));

    expect(out.status).toBe(410);
    expect(
      (await prisma.mechanic.findUniqueOrThrow({ where: { id: elenaCard.id } }))
        .accountId,
    ).toBe(bogdan);
  });

  it('keeps the invite sent and the card free after a refused accept for move_required, so a later revoke works', async () => {
    const { dinamo, id, mihai, sorin } = await world().then(async (w) => {
      const c = await card(w.dinamo.id);
      const r = await send(w.dinamo.id, bearer(w.mihai, 'garage'), {
        email: 'elena@example.test',
        kind: 'mechanic',
        mechanicId: c.id,
      });
      return { ...w, id: r.body.id as string };
    });
    const token = tokenOf().token;

    const refused = await accept(token, bearer(sorin, 'mechanic'));
    const revoked = await revoke(dinamo.id, id, bearer(mihai, 'garage'));
    const after = await accept(token, bearer(sorin, 'mechanic'));

    expect(refused.status).toBe(409);
    expect(revoked.status).toBe(204);
    expect([after.status, after.body.code]).toEqual([410, 'invite_invalid']);
  });
});

describe('resending and revoking a phone invite under hostile input', () => {
  it('answers 409 invite_invalid to a second revoke', async () => {
    const { dinamo, elenaCard, mihai } = await cardAndInvite({
      email: undefined,
      phone: testPhone(1),
    });
    const inv = await prisma.staffInvite.findFirstOrThrow({
      where: { mechanicId: elenaCard.id },
    });

    const first = await revoke(dinamo.id, inv.id, bearer(mihai, 'garage'));
    const second = await revoke(dinamo.id, inv.id, bearer(mihai, 'garage'));

    expect(first.status).toBe(204);
    expect([second.status, second.body.code]).toEqual([409, 'invite_invalid']);
  });

  it('answers the link when a resend by WhatsApp is refused, and keeps the old link until then', async () => {
    const { dinamo, elenaCard, mihai } = await cardAndInvite({
      email: undefined,
      phone: testPhone(1),
    });
    const inv = await prisma.staffInvite.findFirstOrThrow({
      where: { mechanicId: elenaCard.id },
    });
    brevo.answer({ body: { code: 'invalid_parameter' }, status: 400 });

    const res = await resend(dinamo.id, inv.id, bearer(mihai, 'garage'));

    expect(res.status).toBe(200);
    expect(res.body.emailSent).toBe(false);
    expect(res.body.link).toMatch(/\/invite\/[A-Za-z0-9_-]{43}$/);
    expect(brevo.sms()).toHaveLength(0);
  });

  it("answers 404 to another garage's owner resending a card invite", async () => {
    const { elenaCard, radu, nord } = await cardAndInvite();
    const inv = await prisma.staffInvite.findFirstOrThrow({
      where: { mechanicId: elenaCard.id },
    });

    const res = await resend(nord.id, inv.id, bearer(radu, 'garage'));

    expect(res.status).toBe(404);
    expect(brevo.emails()).toHaveLength(1);
  });
});

describe('the team list invite', () => {
  it('shows the newest sent invite when an older sent row also exists', async () => {
    const { dinamo, elenaCard, mihai } = await cardAndInvite();
    await prisma.staffInvite.create({
      data: {
        createdAt: new Date(Date.now() - 20 * DAY),
        email: 'old@example.test',
        expiresAt: new Date(Date.now() - 13 * DAY),
        garageId: dinamo.id,
        kind: 'mechanic',
        mechanicId: elenaCard.id,
        name: 'Elena Stan',
        tokenHash: randomUUID(),
      },
    });

    const item = await listed(dinamo.id, bearer(mihai, 'garage'), elenaCard.id);

    expect(item.invite.email).toBe('elena@example.test');
  });

  it('shows null once the invite is accepted', async () => {
    const { dinamo, elenaCard, mihai } = await cardAndInvite();
    const ana = await account('ana', ['driver']);
    await accept(tokenOf().token, bearer(ana, 'driver'));

    const item = await listed(dinamo.id, bearer(mihai, 'garage'), elenaCard.id);

    expect(item.invite).toBeNull();
  });

  it('shows no invite for a card with an invite to another card', async () => {
    const { dinamo, mihai } = await cardAndInvite();
    const other = await prisma.mechanic.create({
      data: { garageId: dinamo.id, name: 'Dan Popa' },
    });

    const item = await listed(dinamo.id, bearer(mihai, 'garage'), other.id);

    expect(item.invite).toBeNull();
  });
});

describe('a card with an open invite', () => {
  it('stays off the public profile until accepted', async () => {
    const { elenaCard } = await cardAndInvite();

    const row = await prisma.mechanic.findUniqueOrThrow({
      where: { id: elenaCard.id },
    });

    expect(row).toMatchObject({ accountId: null, onProfile: false });
  });
});
