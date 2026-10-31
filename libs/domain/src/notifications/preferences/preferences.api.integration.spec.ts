// @traces 392-FR-009
import { NEWS_CONSENT_TEXT_VERSION } from '@motor-fix/contracts';
import type { Role } from '@motor-fix/contracts/capabilities';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Redis } from 'ioredis';
import request from 'supertest';

import { signAccessToken } from '../../auth/access-token';
import { AuthModule } from '../../auth/auth.module';
import { serialDatabase } from '../../auth/serial-db.testing';
import * as counters from '../../metrics/product-counters';
import { until } from '../../waits.testing';
import { NotificationsModule } from '../notifications.module';
import {
  databaseUrl,
  fixtures,
  redisUrlFor,
  testConfig,
  testPhone,
} from '../notifications.testing';

const redisUrl = redisUrlFor(15);
const tokenSecret = 'test-secret';
const { account, prisma, reset } = fixtures();
serialDatabase(databaseUrl);

const subscriber = new Redis(redisUrl);
const published: string[] = [];
let app: INestApplication;

beforeAll(async () => {
  await subscriber.subscribe('live:events');
  subscriber.on('message', (_channel, message) => published.push(message));
  const auth = AuthModule.register({ databaseUrl, redisUrl, tokenSecret });
  const moduleRef = await Test.createTestingModule({
    imports: [
      auth,
      NotificationsModule.register(
        { databaseUrl, email: testConfig('http://127.0.0.1:9'), redisUrl },
        auth,
      ),
    ],
  }).compile();
  app = moduleRef.createNestApplication();
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
  subscriber.disconnect();
  await prisma.$disconnect();
});

beforeEach(async () => {
  await reset();
  published.length = 0;
});

const bearer = (accountId: string, role: Role = 'driver') =>
  `Bearer ${signAccessToken({ accountId, role }, tokenSecret)}`;

const read = (auth?: string) => {
  const call = request(app.getHttpServer()).get('/notification-preferences');
  return auth ? call.set('Authorization', auth) : call;
};

const save = (body: unknown, auth?: string) => {
  const call = request(app.getHttpServer())
    .put('/notification-preferences')
    .send(body as object);
  return auth ? call.set('Authorization', auth) : call;
};

type GroupKey =
  | 'offers'
  | 'bookings'
  | 'due_dates'
  | 'news'
  | 'reviews_history';

const groupsOf = (body: { groups: { key: GroupKey; enabled: boolean }[] }) =>
  Object.fromEntries(body.groups.map((g) => [g.key, g.enabled])) as Record<
    GroupKey,
    boolean
  >;

const stored = (accountId: string) =>
  prisma.notificationPreference.findMany({
    orderBy: [{ type: 'asc' }, { channel: 'asc' }],
    where: { accountId },
  });

const entries = (accountId: string) =>
  prisma.activityLog.findMany({
    orderBy: { at: 'asc' },
    where: { subjectId: accountId, subjectType: 'notification_preference' },
  });

let phones = 0;

// A driver whose phone is confirmed, so SMS and WhatsApp can be chosen.
async function withPhone(name: string) {
  const id = await account(name);
  await prisma.account.update({
    data: { phone: testPhone(++phones), phoneVerifiedAt: new Date() },
    where: { id },
  });
  return id;
}

async function garageOwner(name: string, roles: Role[] = ['garage']) {
  const id = await account(name, roles);
  const garage = await prisma.garage.create({
    data: { name: `${name} garage`, slug: `${name}-garage` },
  });
  await prisma.garageMember.create({
    data: { accountId: id, garageId: garage.id, role: 'owner' },
  });
  return { garageId: garage.id, id };
}

describe('a driver who has saved nothing', () => {
  it('reads every group on except news, and e-mail as each type’s channel', async () => {
    const driver = await account('andrei');
    const res = await read(bearer(driver));
    expect(res.status).toBe(200);
    expect(groupsOf(res.body)).toEqual({
      bookings: true,
      due_dates: true,
      news: false,
      offers: true,
      reviews_history: true,
    });
    const itp = res.body.preferences.find(
      (p: { type: string }) => p.type === 'DUE_ITP',
    );
    expect(itp).toEqual({
      alwaysSent: false,
      channel: 'email',
      channels: ['email', 'push', 'sms', 'whatsapp'],
      enabled: true,
      fallback: null,
      garageId: null,
      type: 'DUE_ITP',
    });
    expect(await stored(driver)).toEqual([]);
  });
});

describe('switching a group', () => {
  it('turns every type of due dates off and reads back off', async () => {
    const driver = await account('andrei');
    const res = await save(
      { groups: [{ enabled: false, key: 'due_dates' }] },
      bearer(driver),
    );
    expect(res.status).toBe(200);
    expect(groupsOf(res.body).due_dates).toBe(false);
    expect(
      (await stored(driver)).map((r) => [r.type, r.channel, r.enabled]),
    ).toEqual([
      ['DUE_ITP', 'email', false],
      ['DUE_RCA', 'email', false],
      ['DUE_ROVINIETA', 'email', false],
      ['SERVICE_DUE', 'email', false],
      ['TYRES_SEASON', 'email', false],
    ]);
    const again = await read(bearer(driver));
    expect(groupsOf(again.body).due_dates).toBe(false);
  });

  it('leaves the always-sent types of bookings alone', async () => {
    const driver = await account('andrei');
    await save(
      { groups: [{ enabled: false, key: 'bookings' }] },
      bearer(driver),
    );
    const types = (await stored(driver)).map((r) => r.type);
    expect(types).toContain('BOOKING_REMINDER');
    expect(types).not.toContain('BOOKING_CONFIRMED');
    expect(types).not.toContain('JOB_READY');
    expect(types).not.toContain('BOOKING_MOVE_LAPSED');
  });

  it('keeps the channel a type already had', async () => {
    const driver = await withPhone('andrei');
    await save(
      {
        preferences: [
          {
            channel: 'whatsapp',
            enabled: true,
            garageId: null,
            type: 'QUOTE_RECEIVED',
          },
        ],
      },
      bearer(driver),
    );
    await save({ groups: [{ enabled: false, key: 'offers' }] }, bearer(driver));
    const quote = (await stored(driver)).filter(
      (r) => r.type === 'QUOTE_RECEIVED',
    );
    expect(quote).toEqual([
      expect.objectContaining({ channel: 'whatsapp', enabled: false }),
    ]);
  });

  it('writes one audit entry per group switched, and none when nothing changed', async () => {
    const driver = await account('andrei');
    const body = { groups: [{ enabled: false, key: 'due_dates' }] };
    await save(body, bearer(driver));
    await save(body, bearer(driver));
    const written = await entries(driver);
    expect(written).toHaveLength(1);
    expect(written[0]).toMatchObject({
      action: 'update',
      actorId: driver,
      field: 'group.due_dates',
      newValue: false,
      oldValue: true,
    });
  });
});

describe('choosing for one type', () => {
  it('keeps one row per driver type, on the channel chosen last', async () => {
    const driver = await withPhone('andrei');
    for (const channel of ['push', 'whatsapp']) {
      const res = await save(
        {
          preferences: [
            { channel, enabled: true, garageId: null, type: 'QUOTE_RECEIVED' },
          ],
        },
        bearer(driver),
      );
      expect(res.status).toBe(200);
    }
    expect(
      (await stored(driver)).map((r) => [r.type, r.channel, r.enabled]),
    ).toEqual([['QUOTE_RECEIVED', 'whatsapp', true]]);
    const res = await read(bearer(driver));
    expect(
      res.body.preferences.find(
        (p: { type: string }) => p.type === 'QUOTE_RECEIVED',
      ),
    ).toMatchObject({ channel: 'whatsapp', enabled: true });
  });

  it('lets a driver choose SMS for a reminder', async () => {
    const driver = await withPhone('sms-driver');
    const res = await save(
      {
        preferences: [
          { channel: 'sms', enabled: true, garageId: null, type: 'DUE_ITP' },
        ],
      },
      bearer(driver),
    );
    expect(res.status).toBe(200);
    expect(
      (await stored(driver)).map((r) => [r.type, r.channel, r.enabled]),
    ).toEqual([['DUE_ITP', 'sms', true]]);
  });

  it('records who changed which type, its channel, and the old and new value', async () => {
    const driver = await account('andrei');
    await save(
      {
        preferences: [
          { channel: 'push', enabled: false, garageId: null, type: 'DUE_RCA' },
        ],
      },
      bearer(driver),
    );
    expect(await entries(driver)).toEqual([
      expect.objectContaining({
        actorId: driver,
        field: 'DUE_RCA',
        newValue: { channel: 'push', enabled: false },
        oldValue: { channel: 'email', enabled: true },
      }),
    ]);
  });

  it('lets two saves at once leave one row, the last one’s', async () => {
    const driver = await withPhone('andrei');
    const choose = (channel: string) =>
      save(
        {
          preferences: [
            { channel, enabled: true, garageId: null, type: 'JOB_STARTED' },
          ],
        },
        bearer(driver),
      );
    const answers = await Promise.all([choose('push'), choose('whatsapp')]);
    expect(answers.map((a) => a.status)).toEqual([200, 200]);
    expect(
      (await stored(driver)).filter((r) => r.type === 'JOB_STARTED'),
    ).toHaveLength(1);
  });
});

describe('garage staff', () => {
  it('mute one channel of a type for their garage', async () => {
    const owner = await garageOwner('ion');
    const res = await save(
      {
        preferences: [
          {
            channel: 'push',
            enabled: false,
            garageId: owner.garageId,
            type: 'REQUEST_RECEIVED',
          },
        ],
      },
      bearer(owner.id, 'garage'),
    );
    expect(res.status).toBe(200);
    expect(
      res.body.preferences.filter(
        (p: { garageId: string | null }) => p.garageId !== null,
      ),
    ).toEqual([
      {
        alwaysSent: false,
        channel: 'push',
        channels: ['push'],
        enabled: false,
        garageId: owner.garageId,
        type: 'REQUEST_RECEIVED',
      },
    ]);
    expect(await entries(owner.id)).toEqual([
      expect.objectContaining({
        field: 'REQUEST_RECEIVED.push',
        garageId: owner.garageId,
        newValue: false,
        oldValue: true,
      }),
    ]);
  });

  it('keep driver rows and garage rows apart on one account', async () => {
    const both = await garageOwner('maria', ['driver', 'garage']);
    await save(
      {
        groups: [{ enabled: false, key: 'offers' }],
        preferences: [
          {
            channel: 'email',
            enabled: false,
            garageId: both.garageId,
            type: 'REQUEST_RECEIVED',
          },
        ],
      },
      bearer(both.id, 'driver'),
    );
    const res = await read(bearer(both.id, 'garage'));
    const garageRows = res.body.preferences.filter(
      (p: { garageId: string | null }) => p.garageId === both.garageId,
    );
    expect(garageRows.map((p: { type: string }) => p.type)).toEqual([
      'REQUEST_RECEIVED',
    ]);
    expect(groupsOf(res.body).offers).toBe(false);
  });
});

describe('a save that is refused', () => {
  const refused = async (
    body: unknown,
    status: number,
    code?: string,
    role: Role = 'driver',
  ) => {
    const caller = await account(`caller-${status}-${code ?? 'shape'}`, [role]);
    const res = await save(body, bearer(caller, role));
    expect(res.status).toBe(status);
    if (code) expect(res.body).toMatchObject({ code });
    expect(await stored(caller)).toEqual([]);
    expect(await entries(caller)).toEqual([]);
  };

  it('answers 422 to switching off an always-sent type', () =>
    refused(
      {
        groups: [{ enabled: false, key: 'due_dates' }],
        preferences: [
          {
            channel: 'email',
            enabled: false,
            garageId: null,
            type: 'BOOKING_CONFIRMED',
          },
        ],
      },
      422,
      'notification_type_always_sent',
    ));

  it('answers 422 to switching off a transactional type', () =>
    refused(
      {
        preferences: [
          {
            channel: 'email',
            enabled: false,
            garageId: null,
            type: 'ACCOUNT_EMAIL',
          },
        ],
      },
      422,
      'notification_type_always_sent',
    ));

  it('answers 400 to a type that is not in the catalogue', () =>
    refused(
      {
        preferences: [
          { channel: 'email', enabled: false, garageId: null, type: 'NOPE' },
        ],
      },
      400,
      'unknown_notification_type',
    ));

  it('answers 400 to a channel the type does not allow', () =>
    refused(
      {
        preferences: [
          {
            channel: 'sms',
            enabled: true,
            garageId: null,
            type: 'QUOTE_RECEIVED',
          },
        ],
      },
      400,
      'channel_not_allowed',
    ));

  it('answers 400 to SMS for a review invite, which never goes by SMS', () =>
    refused(
      {
        preferences: [
          {
            channel: 'sms',
            enabled: true,
            garageId: null,
            type: 'REVIEW_INVITE',
          },
        ],
      },
      400,
      'channel_not_allowed',
    ));

  it.each(['garage', 'mechanic', 'admin'] as const)(
    'answers 422 to SMS chosen by a %s, even for a reminder',
    (role) =>
      refused(
        {
          preferences: [
            { channel: 'sms', enabled: true, garageId: null, type: 'DUE_ITP' },
          ],
        },
        422,
        'channel_not_allowed',
        role,
      ),
  );

  it('answers 400 to a garage on a driver type', async () => {
    const owner = await garageOwner('ion');
    const res = await save(
      {
        preferences: [
          {
            channel: 'email',
            enabled: false,
            garageId: owner.garageId,
            type: 'QUOTE_RECEIVED',
          },
        ],
      },
      bearer(owner.id, 'garage'),
    );
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ code: 'garage_not_allowed' });
    expect(await stored(owner.id)).toEqual([]);
  });

  it('answers 404 to a garage the caller does not belong to', async () => {
    const other = await garageOwner('vasile');
    await refused(
      {
        preferences: [
          {
            channel: 'push',
            enabled: false,
            garageId: other.garageId,
            type: 'REQUEST_RECEIVED',
          },
        ],
      },
      404,
      'not_found',
      'garage',
    );
  });

  it('answers 400 to a choice without enabled', () =>
    refused(
      {
        preferences: [
          { channel: 'email', garageId: null, type: 'QUOTE_RECEIVED' },
        ],
      },
      400,
    ));

  it('answers 400 to a group that does not exist', () =>
    refused({ groups: [{ enabled: false, key: 'spam' }] }, 400));
});

describe('whose preferences', () => {
  it('reads and changes only the caller’s own', async () => {
    const andrei = await account('andrei');
    const elena = await account('elena');
    await save({ groups: [{ enabled: false, key: 'offers' }] }, bearer(andrei));
    expect(groupsOf((await read(bearer(elena))).body).offers).toBe(true);
    expect(await stored(elena)).toEqual([]);
  });

  it('answers 401 without a session', async () => {
    expect((await read()).status).toBe(401);
    expect(
      (await save({ groups: [{ enabled: false, key: 'offers' }] })).status,
    ).toBe(401);
  });
});

describe('the person’s other tabs', () => {
  it('are told the preferences changed', async () => {
    const driver = await account('andrei');
    await save({ groups: [{ enabled: false, key: 'news' }] }, bearer(driver));
    await save(
      {
        groups: [{ enabled: true, key: 'news' }],
        newsConsentTextVersion: NEWS_CONSENT_TEXT_VERSION,
      },
      bearer(driver),
    );
    const updates = () =>
      published.filter((m) => m.includes('notification_preferences.updated'));
    await until('both announcements', () => updates().length >= 2);
    // Long enough for a third, wrong, announcement to arrive.
    await new Promise((resolve) => setTimeout(resolve, 200));
    const told = published
      .map((m) => JSON.parse(m))
      .filter((m) => m.event.kind === 'notification_preferences.updated');
    expect(told).toHaveLength(2);
    expect(told[0].audience).toEqual([`account:${driver}`]);
  });
});

async function garage(name: string) {
  return prisma.garage.create({ data: { name, slug: name.toLowerCase() } });
}

async function staff(
  name: string,
  garageId: string,
  role: 'owner' | 'receptionist',
  roles: Role[] = [role === 'owner' ? 'garage' : 'receptionist'],
) {
  const id = await account(name, roles);
  await prisma.garageMember.create({ data: { accountId: id, garageId, role } });
  return id;
}

async function mechanic(
  name: string,
  garageId: string,
  canAnswerQuotes: boolean,
) {
  const id = await account(name, ['mechanic']);
  await prisma.mechanic.create({
    data: { accountId: id, canAnswerQuotes, garageId, name: 'Mecanic' },
  });
  return id;
}

const verifyPhone = (accountId: string, n: number) =>
  prisma.account.update({
    data: { phone: `+4071000000${n}`, phoneVerifiedAt: new Date() },
    where: { id: accountId },
  });

const feature = (garageId: string, key: string, enabled: boolean) =>
  prisma.garageFeature.upsert({
    create: { enabled, garageId, key },
    update: { enabled },
    where: { garageId_key: { garageId, key } },
  });

interface StaffEntry {
  garageId: string | null;
  garageName: string | null;
  role: string;
  whatsapp: { available: boolean; reason: string | null };
  sections: {
    key: string;
    types: {
      type: string;
      channels: { channel: string; enabled: boolean; locked: boolean }[];
    }[];
  }[];
}

const staffOf = async (accountId: string, role: Role) =>
  (await read(bearer(accountId, role))).body.staff as StaffEntry[];

const typesIn = (entry: StaffEntry) =>
  entry.sections.flatMap((s) => s.types.map((t) => t.type));

const channelsIn = (entry: StaffEntry, type: string) =>
  entry.sections.flatMap((s) => s.types).find((t) => t.type === type)?.channels;

// @traces 198-FR-001 198-FR-002 198-FR-004
describe('the staff lists a person reads', () => {
  it('give a driver none', async () => {
    const driver = await account('andrei');
    expect(await staffOf(driver, 'driver')).toEqual([]);
  });

  it('give the owner the whole garage list, the receptionist less', async () => {
    const { id: garageId } = await garage('Dinamo');
    const owner = await staff('ion', garageId, 'owner');
    const receptionist = await staff('ana', garageId, 'receptionist');
    const [mine] = await staffOf(owner, 'garage');
    const [theirs] = await staffOf(receptionist, 'receptionist');
    expect(mine).toMatchObject({
      garageId,
      garageName: 'Dinamo',
      role: 'owner',
    });
    expect(typesIn(mine)).toHaveLength(30);
    expect(theirs.role).toBe('receptionist');
    expect(typesIn(theirs)).not.toContain('REVIEW_POSTED');
    expect(typesIn(theirs)).not.toContain('DOCUMENT_DUE');
    expect(typesIn(theirs)).toContain('REQUEST_RECEIVED');
  });

  it('give a mechanic requests and messages only when they answer quotes', async () => {
    const { id: garageId } = await garage('Dinamo');
    const quoting = await mechanic('mihai', garageId, true);
    const plain = await mechanic('dan', garageId, false);
    expect(typesIn((await staffOf(quoting, 'mechanic'))[0])).toEqual([
      'REQUEST_RECEIVED',
      'MESSAGE_RECEIVED',
      'BOOKING_MOVED',
    ]);
    expect(typesIn((await staffOf(plain, 'mechanic'))[0])).toEqual([
      'BOOKING_MOVED',
    ]);
  });

  it('give an admin one entry with no garage and the nine admin types', async () => {
    const admin = await account('alina', ['admin']);
    const [entry] = await staffOf(admin, 'admin');
    expect(entry).toMatchObject({
      garageId: null,
      garageName: null,
      role: 'admin',
    });
    expect(typesIn(entry)).toHaveLength(9);
    expect(channelsIn(entry, 'ADMIN_OUTAGE_ALERT')).toEqual([
      { channel: 'email', enabled: true, locked: true },
      { channel: 'push', enabled: true, locked: true },
    ]);
  });

  it('give one list per garage, and keep a mechanic’s and an admin’s apart', async () => {
    const { id: first } = await garage('Dinamo');
    const { id: second } = await garage('Vulcan');
    const person = await staff('ion', first, 'owner', [
      'garage',
      'mechanic',
      'admin',
    ]);
    await prisma.mechanic.create({
      data: {
        accountId: person,
        canAnswerQuotes: false,
        garageId: second,
        name: 'Mecanic',
      },
    });
    const entries = await staffOf(person, 'garage');
    expect(entries.map((e) => [e.garageName, e.role])).toEqual([
      ['Dinamo', 'owner'],
      ['Vulcan', 'mechanic'],
      [null, 'admin'],
    ]);
  });

  it('leave a driver’s groups as they are for a person who is also staff', async () => {
    const { id: garageId } = await garage('Dinamo');
    const both = await staff('maria', garageId, 'owner', ['driver', 'garage']);
    const res = await read(bearer(both, 'driver'));
    expect(groupsOf(res.body).offers).toBe(true);
    expect(res.body.staff).toHaveLength(1);
  });

  it('drop a garage once the membership ends', async () => {
    const { id: garageId } = await garage('Dinamo');
    const owner = await staff('ion', garageId, 'owner');
    await prisma.garageMember.deleteMany({ where: { accountId: owner } });
    expect(await staffOf(owner, 'garage')).toEqual([]);
  });

  // @traces 198-FR-002
  it('say why WhatsApp cannot be chosen, the garage first', async () => {
    const { id: garageId } = await garage('Dinamo');
    const owner = await staff('ion', garageId, 'owner');
    expect((await staffOf(owner, 'garage'))[0].whatsapp).toEqual({
      available: false,
      reason: 'phone_not_verified',
    });
    await feature(garageId, 'whatsapp', false);
    expect((await staffOf(owner, 'garage'))[0].whatsapp).toEqual({
      available: false,
      reason: 'garage_whatsapp_off',
    });
    await verifyPhone(owner, 1);
    expect((await staffOf(owner, 'garage'))[0].whatsapp.reason).toBe(
      'garage_whatsapp_off',
    );
    await feature(garageId, 'whatsapp', true);
    expect((await staffOf(owner, 'garage'))[0].whatsapp).toEqual({
      available: true,
      reason: null,
    });
  });

  // @traces 198-FR-004
  it('list the day sheet types only while day sheets are not off', async () => {
    const { id: garageId } = await garage('Dinamo');
    const owner = await staff('ion', garageId, 'owner');
    await feature(garageId, 'day_sheets', false);
    expect(typesIn((await staffOf(owner, 'garage'))[0])).not.toContain(
      'DAY_SHEET_OUTDATED',
    );
    await feature(garageId, 'day_sheets', true);
    expect(typesIn((await staffOf(owner, 'garage'))[0])).toContain(
      'DAY_SHEET_OUTDATED',
    );
  });
});

// @traces 198-FR-007
describe('a staff save', () => {
  const choice = (
    garageId: string | null,
    type: string,
    channel: string,
    enabled: boolean,
  ) => ({ channel, enabled, garageId, type });

  it('saves per channel, reads back, records and announces each change', async () => {
    const { id: garageId } = await garage('Dinamo');
    const owner = await staff('ion', garageId, 'owner');
    const res = await save(
      {
        preferences: [
          choice(garageId, 'REQUEST_RECEIVED', 'email', false),
          choice(garageId, 'BOOKING_CANCELLED', 'push', false),
        ],
      },
      bearer(owner, 'garage'),
    );
    expect(res.status).toBe(200);
    const entry = (res.body.staff as StaffEntry[])[0];
    expect(channelsIn(entry, 'REQUEST_RECEIVED')?.[0].enabled).toBe(false);
    expect(channelsIn(entry, 'BOOKING_CANCELLED')).toEqual([
      { channel: 'email', enabled: true, locked: true },
      { channel: 'push', enabled: false, locked: false },
      { channel: 'whatsapp', enabled: false, locked: false },
    ]);
    expect(
      channelsIn((await staffOf(owner, 'garage'))[0], 'REQUEST_RECEIVED')?.[0]
        .enabled,
    ).toBe(false);
    expect(await entries(owner)).toHaveLength(2);
    await until('the announcement', () =>
      published.some((m) => m.includes('notification_preferences.updated')),
    );
    // Long enough for a second, wrong, announcement to arrive.
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(
      published
        .map((m) => JSON.parse(m))
        .filter((m) => m.event.kind === 'notification_preferences.updated'),
    ).toHaveLength(1);
  });

  it('lets a receptionist mute only their own channels', async () => {
    const { id: garageId } = await garage('Dinamo');
    const owner = await staff('ion', garageId, 'owner');
    const receptionist = await staff('ana', garageId, 'receptionist');
    await save(
      { preferences: [choice(garageId, 'REQUEST_RECEIVED', 'email', false)] },
      bearer(receptionist, 'receptionist'),
    );
    expect(
      channelsIn((await staffOf(owner, 'garage'))[0], 'REQUEST_RECEIVED')?.[0]
        .enabled,
    ).toBe(true);
    expect(await stored(owner)).toEqual([]);
  });

  // @traces 198-FR-008
  describe('refused', () => {
    const refusedFor = async (
      accountId: string,
      role: Role,
      preferences: unknown[],
      status: number,
      code: string,
    ) => {
      const before = await stored(accountId);
      const res = await save({ preferences }, bearer(accountId, role));
      expect(res.status).toBe(status);
      expect(res.body).toMatchObject({ code });
      expect(await stored(accountId)).toEqual(before);
      expect(await entries(accountId)).toEqual([]);
    };

    it('for SMS', async () => {
      const { id: garageId } = await garage('Dinamo');
      const owner = await staff('ion', garageId, 'owner');
      await refusedFor(
        owner,
        'garage',
        [choice(garageId, 'REQUEST_RECEIVED', 'sms', true)],
        422,
        'channel_not_allowed',
      );
    });

    it('for a type outside the caller’s list', async () => {
      const { id: garageId } = await garage('Dinamo');
      const receptionist = await staff('ana', garageId, 'receptionist');
      const mech = await mechanic('mihai', garageId, true);
      await refusedFor(
        receptionist,
        'receptionist',
        [choice(garageId, 'REVIEW_POSTED', 'email', false)],
        422,
        'type_not_in_list',
      );
      await refusedFor(
        mech,
        'mechanic',
        [choice(garageId, 'QUOTE_ACCEPTED', 'email', false)],
        422,
        'type_not_in_list',
      );
    });

    it('for an admin type saved by someone who is not an admin', async () => {
      const { id: garageId } = await garage('Dinamo');
      const owner = await staff('ion', garageId, 'owner');
      await refusedFor(
        owner,
        'garage',
        [choice(null, 'ADMIN_RECHECK_DUE', 'email', false)],
        422,
        'type_not_in_list',
      );
    });

    it('for a locked channel switched off', async () => {
      const { id: garageId } = await garage('Dinamo');
      const owner = await staff('ion', garageId, 'owner');
      await refusedFor(
        owner,
        'garage',
        [choice(garageId, 'VERIFICATION_RESULT', 'email', false)],
        422,
        'channel_locked',
      );
      const admin = await account('alina', ['admin']);
      for (const channel of ['email', 'push']) {
        await refusedFor(
          admin,
          'admin',
          [choice(null, 'ADMIN_OUTAGE_ALERT', channel, false)],
          422,
          'channel_locked',
        );
      }
    });

    it('for WhatsApp the garage turned off or with no verified phone', async () => {
      const { id: garageId } = await garage('Dinamo');
      const owner = await staff('ion', garageId, 'owner');
      await refusedFor(
        owner,
        'garage',
        [choice(garageId, 'REQUEST_RECEIVED', 'whatsapp', true)],
        422,
        'whatsapp_unavailable',
      );
      await verifyPhone(owner, 2);
      await feature(garageId, 'whatsapp', false);
      await refusedFor(
        owner,
        'garage',
        [choice(garageId, 'REQUEST_RECEIVED', 'whatsapp', true)],
        422,
        'whatsapp_unavailable',
      );
    });

    // @traces 068-FR-004
    it.each([
      ['DOCUMENT_DUE', 'push'],
      ['DOCUMENT_OVERDUE', 'email'],
    ] as const)('for %s muted on %s', async (type, channel) => {
      const { id: garageId } = await garage('Dinamo');
      const owner = await staff('ion', garageId, 'owner');
      await refusedFor(
        owner,
        'garage',
        [choice(garageId, type, channel, false)],
        422,
        'channel_locked',
      );
    });

    it('with 404 for a garage the caller is not staff of', async () => {
      const { id: mine } = await garage('Dinamo');
      const { id: theirs } = await garage('Vulcan');
      const owner = await staff('ion', mine, 'owner');
      await refusedFor(
        owner,
        'garage',
        [choice(theirs, 'REQUEST_RECEIVED', 'email', false)],
        404,
        'not_found',
      );
    });
  });
});

// @traces 142-FR-003 142-FR-004 142-FR-005 142-FR-009
describe('what the panel reads besides the choices', () => {
  it('says whether the phone is confirmed', async () => {
    const without = await account('no-phone');
    const confirmed = await withPhone('confirmed');
    const unconfirmed = await account('unconfirmed');
    await prisma.account.update({
      data: { phone: testPhone(++phones) },
      where: { id: unconfirmed },
    });
    expect((await read(bearer(without))).body.phoneVerified).toBe(false);
    expect((await read(bearer(confirmed))).body.phoneVerified).toBe(true);
    expect((await read(bearer(unconfirmed))).body.phoneVerified).toBe(false);
  });

  it('gives the SMS sent this Bucharest month out of the cap', async () => {
    const driver = await account('counted');
    expect((await read(bearer(driver))).body.sms).toEqual({ cap: 5, used: 0 });
    const month = new Intl.DateTimeFormat('en-CA', {
      month: '2-digit',
      timeZone: 'Europe/Bucharest',
      year: 'numeric',
    })
      .format(new Date())
      .slice(0, 7);
    await prisma.smsCounter.create({
      data: { accountId: driver, month: '2000-01', sentCount: 3 },
    });
    expect((await read(bearer(driver))).body.sms).toEqual({ cap: 5, used: 0 });
    await prisma.smsCounter.create({
      data: { accountId: driver, month, sentCount: 5 },
    });
    expect((await read(bearer(driver))).body.sms).toEqual({ cap: 5, used: 5 });
  });

  it('says whether the account has a push device, and defaults to push when it has', async () => {
    const driver = await account('pusher');
    let res = await read(bearer(driver));
    expect(res.body.pushDevice).toBe(false);
    const itp = (body: { preferences: { type: string; channel: string }[] }) =>
      body.preferences.find((p) => p.type === 'DUE_ITP')?.channel;
    expect(itp(res.body)).toBe('email');
    const device = await prisma.pushSubscription.create({
      data: {
        accountId: driver,
        auth: 'auth',
        endpoint: 'https://push.example.test/1',
        label: 'test',
        p256dh: 'key',
      },
    });
    res = await read(bearer(driver));
    expect(res.body.pushDevice).toBe(true);
    expect(itp(res.body)).toBe('push');
    expect(
      res.body.preferences.find((p: { type: string }) => p.type === 'JOB_READY')
        ?.channel,
    ).toBe('email');
    await prisma.pushSubscription.delete({ where: { id: device.id } });
    res = await read(bearer(driver));
    expect(itp(res.body)).toBe('email');
  });

  it('gives each driver type the channels it can be picked on', async () => {
    const res = await read(bearer(await account('lister')));
    const channels = (type: string) =>
      res.body.preferences.find((p: { type: string }) => p.type === type)
        ?.channels;
    expect(channels('DUE_ITP')).toEqual(['email', 'push', 'sms', 'whatsapp']);
    expect(channels('QUOTE_RECEIVED')).toEqual(['email', 'push', 'whatsapp']);
    expect(channels('REVIEW_INVITE')).toEqual(['email', 'push', 'whatsapp']);
    expect(channels('NEWS')).toEqual(['email']);
  });

  it('is the caller’s own: another driver reads their own phone, SMS and devices', async () => {
    const andrei = await withPhone('andrei');
    await prisma.smsCounter.create({
      data: {
        accountId: andrei,
        month: new Intl.DateTimeFormat('en-CA', {
          month: '2-digit',
          timeZone: 'Europe/Bucharest',
          year: 'numeric',
        })
          .format(new Date())
          .slice(0, 7),
        sentCount: 4,
      },
    });
    const elena = await account('elena');
    const res = await read(bearer(elena));
    expect(res.body).toMatchObject({
      phoneVerified: false,
      pushDevice: false,
      sms: { cap: 5, used: 0 },
    });
  });
});

// @traces 142-FR-003
describe('a driver without a confirmed phone', () => {
  const choose = (channel: string, type = 'DUE_ITP') => ({
    preferences: [{ channel, enabled: true, garageId: null, type }],
  });

  it.each(['sms', 'whatsapp'])('cannot choose %s', async (channel) => {
    const driver = await account('no-phone');
    const res = await save(choose(channel), bearer(driver));
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('phone_not_verified');
    expect(await stored(driver)).toEqual([]);
    expect(await entries(driver)).toEqual([]);
  });

  it('cannot choose WhatsApp with a phone not yet confirmed', async () => {
    const driver = await account('unconfirmed');
    await prisma.account.update({
      data: { phone: testPhone(++phones) },
      where: { id: driver },
    });
    const res = await save(
      choose('whatsapp', 'QUOTE_RECEIVED'),
      bearer(driver),
    );
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('phone_not_verified');
  });

  it('can still choose e-mail and push, and switch groups', async () => {
    const driver = await account('no-phone');
    expect((await save(choose('push'), bearer(driver))).status).toBe(200);
    expect((await save(choose('email'), bearer(driver))).status).toBe(200);
    expect(
      (
        await save(
          { groups: [{ enabled: false, key: 'due_dates' }] },
          bearer(driver),
        )
      ).status,
    ).toBe(200);
  });
});

// @traces 142-FR-002 142-FR-008 142-FR-010
describe('the Build brief’s save scenarios', () => {
  const pick = (type: string, channel: string, enabled = true) => ({
    preferences: [{ channel, enabled, garageId: null, type }],
  });

  it('refuses SMS for every type of Ofertă nouă and for REVIEW_INVITE', async () => {
    const driver = await withPhone('offers');
    const offers = (await read(bearer(driver))).body.groups.find(
      (g: { key: string }) => g.key === 'offers',
    ).types as string[];
    for (const type of [...offers, 'REVIEW_INVITE']) {
      const res = await save(pick(type, 'sms'), bearer(driver));
      expect([400, 422]).toContain(res.status);
      expect(res.body.code).toBe('channel_not_allowed');
    }
    expect(
      (await save(pick('REVIEW_INVITE', 'whatsapp'), bearer(driver))).status,
    ).toBe(200);
  });

  it('lets JOB_READY’s channel be picked but never switched off', async () => {
    const driver = await withPhone('ready');
    expect(
      (await save(pick('JOB_READY', 'whatsapp'), bearer(driver))).status,
    ).toBe(200);
    const off = await save(
      pick('JOB_READY', 'whatsapp', false),
      bearer(driver),
    );
    expect(off.status).toBe(422);
    expect(off.body.code).toBe('notification_type_always_sent');
  });

  it('keeps NEWS on e-mail', async () => {
    const driver = await account('news');
    const res = await save(pick('NEWS', 'push', false), bearer(driver));
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('channel_not_allowed');
  });

  it('saves a pick at once, audits it once, announces it, and records nothing for the same pick again', async () => {
    const driver = await withPhone('picker');
    const choices = jest.spyOn(counters, 'countChannelChoice');
    const res = await save(pick('DUE_ITP', 'whatsapp'), bearer(driver));
    expect(choices.mock.calls).toEqual([['whatsapp']]);
    expect(res.status).toBe(200);
    expect(
      res.body.preferences.find((p: { type: string }) => p.type === 'DUE_ITP'),
    ).toMatchObject({ channel: 'whatsapp', enabled: true });
    const audited = await entries(driver);
    expect(audited).toHaveLength(1);
    expect(audited[0]).toMatchObject({
      field: 'DUE_ITP',
      newValue: { channel: 'whatsapp', enabled: true },
      oldValue: { channel: 'email', enabled: true },
    });
    await until('the change published live', () => published.length > 0);
    await save(pick('DUE_ITP', 'whatsapp'), bearer(driver));
    expect(await entries(driver)).toHaveLength(1);
    expect(choices).toHaveBeenCalledTimes(1);
    choices.mockRestore();
  });
});

// @traces 1374-FR-004
// @traces 1374-FR-005
// @traces 1374-FR-006
// @traces 1374-FR-007
describe('the fallback a driver entry carries', () => {
  const at = new Date('2026-10-20T08:00:00Z');

  const keep = (
    accountId: string,
    type: string,
    from: 'email' | 'push' | 'sms' | 'whatsapp',
    to: 'email' | 'push' | 'sms' | 'whatsapp' = 'email',
    when = at,
  ) =>
    prisma.notificationFallback.create({
      data: { accountId, at: when, from, reason: 'no_device', to, type },
    });

  const choose = (accountId: string, type: string, channel: string) =>
    prisma.notificationPreference.create({
      data: {
        accountId,
        channel: channel as 'email',
        enabled: true,
        type,
        updatedAt: new Date('2026-10-19T08:00:00Z'),
      },
    });

  const entry = (
    body: { preferences: Record<string, unknown>[] },
    type: string,
  ) =>
    body.preferences.find((p) => p['type'] === type && p['garageId'] === null);

  it('gives the record beside the type while it explains the chosen channel', async () => {
    const driver = await account('andrei');
    await choose(driver, 'DUE_ITP', 'push');
    await keep(driver, 'DUE_ITP', 'push');
    const res = await read(bearer(driver));
    expect(res.status).toBe(200);
    expect(entry(res.body, 'DUE_ITP')?.['fallback']).toEqual({
      at: '2026-10-20T08:00:00.000Z',
      from: 'push',
      reason: 'no_device',
      to: 'email',
    });
  });

  it('gives null for a type with no record', async () => {
    const driver = await account('andrei');
    const res = await read(bearer(driver));
    expect(entry(res.body, 'DUE_ITP')?.['fallback']).toBeNull();
  });

  it('gives it for a type with nothing saved whose default is the record’s channel', async () => {
    const driver = await account('andrei');
    await keep(driver, 'DUE_RCA', 'email', 'push');
    const res = await read(bearer(driver));
    expect(entry(res.body, 'DUE_RCA')?.['fallback']).toEqual(
      expect.objectContaining({ from: 'email', to: 'push' }),
    );
  });

  it('drops it once the driver saves another channel, and after saving the first one again', async () => {
    const driver = await withPhone('andrei');
    await choose(driver, 'DUE_ITP', 'push');
    await keep(driver, 'DUE_ITP', 'push');
    const moved = await save(
      {
        preferences: [
          { channel: 'sms', enabled: true, garageId: null, type: 'DUE_ITP' },
        ],
      },
      bearer(driver),
    );
    expect(moved.status).toBe(200);
    expect(entry(moved.body, 'DUE_ITP')?.['fallback']).toBeNull();
    await save(
      {
        preferences: [
          { channel: 'push', enabled: true, garageId: null, type: 'DUE_ITP' },
        ],
      },
      bearer(driver),
    );
    const back = await read(bearer(driver));
    expect(entry(back.body, 'DUE_ITP')?.['channel']).toBe('push');
    expect(entry(back.body, 'DUE_ITP')?.['fallback']).toBeNull();
  });

  it('leaves the staff entries without the field', async () => {
    const { garageId, id } = await garageOwner('ion');
    await prisma.notificationPreference.create({
      data: {
        accountId: id,
        channel: 'push',
        enabled: false,
        garageId,
        type: 'REQUEST_RECEIVED',
      },
    });
    await keep(id, 'REQUEST_RECEIVED', 'push');
    const res = await read(bearer(id, 'garage'));
    const staff = res.body.preferences.filter(
      (p: { garageId: string | null }) => p.garageId !== null,
    );
    expect(staff.length).toBeGreaterThan(0);
    for (const p of staff) expect(p).not.toHaveProperty('fallback');
  });

  it('is removed with the account', async () => {
    const driver = await account('andrei');
    await keep(driver, 'DUE_ITP', 'push');
    await prisma.account.delete({ where: { id: driver } });
    expect(
      await prisma.notificationFallback.count({
        where: { accountId: driver },
      }),
    ).toBe(0);
  });
});
