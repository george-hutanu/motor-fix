// @traces 392-FR-009
import { NEWS_CONSENT_TEXT_VERSION } from '@motor-fix/contracts';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Redis } from 'ioredis';
import request from 'supertest';

import { NotificationsModule } from './notifications.module';
import {
  databaseUrl,
  fixtures,
  redisUrlFor,
  testConfig,
} from './notifications.testing';
import { signAccessToken } from '../auth/access-token';
import { AuthModule } from '../auth/auth.module';
import type { Role } from '../auth/capabilities';
import { serialDatabase } from '../auth/serial-db.testing';

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
      enabled: true,
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
    const driver = await account('andrei');
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
    const driver = await account('andrei');
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
    const driver = await account('sms-driver');
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
    const driver = await account('andrei');
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

  it.each([
    'garage',
    'mechanic',
    'admin',
  ] as const)('answers 422 to SMS chosen by a %s, even for a reminder', (role) =>
    refused(
      {
        preferences: [
          { channel: 'sms', enabled: true, garageId: null, type: 'DUE_ITP' },
        ],
      },
      422,
      'channel_not_allowed',
      role,
    ));

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
    await new Promise((resolve) => setTimeout(resolve, 200));
    const told = published
      .map((m) => JSON.parse(m))
      .filter((m) => m.event.kind === 'notification_preferences.updated');
    expect(told).toHaveLength(2);
    expect(told[0].audience).toEqual([`account:${driver}`]);
  });
});
