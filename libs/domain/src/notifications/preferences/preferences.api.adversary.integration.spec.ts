import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { signAccessToken } from '../../auth/access-token';
import { AuthModule } from '../../auth/auth.module';
import type { Role } from '../../auth/capabilities';
import { serialDatabase } from '../../auth/serial-db.testing';
import * as counters from '../../metrics/product-counters';
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

let app: INestApplication;

beforeAll(async () => {
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
  await prisma.$disconnect();
});

beforeEach(reset);

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

const pick = (type: string, channel: unknown, enabled: unknown = true) => ({
  preferences: [{ channel, enabled, garageId: null, type }],
});

const stored = (accountId: string) =>
  prisma.notificationPreference.findMany({ where: { accountId } });
const audited = (accountId: string) =>
  prisma.activityLog.findMany({
    where: { subjectId: accountId, subjectType: 'notification_preference' },
  });

let phones = 100;
async function withPhone(name: string) {
  const id = await account(name);
  await prisma.account.update({
    data: { phone: testPhone(++phones), phoneVerifiedAt: new Date() },
    where: { id },
  });
  return id;
}

const channelOf = (
  body: { preferences: { type: string; channel: string }[] },
  type: string,
) => body.preferences.find((p) => p.type === type)?.channel;

// @traces 142-FR-009
describe('the preferences without a session', () => {
  it('answers 401 to a read and a save with a malformed bearer', async () => {
    expect((await read('Bearer not-a-token')).status).toBe(401);
    expect(
      (await save(pick('DUE_ITP', 'sms'), 'Bearer not-a-token')).status,
    ).toBe(401);
  });

  it('answers 401 to a token signed with another secret', async () => {
    const forged = `Bearer ${signAccessToken({ accountId: await account('x'), role: 'driver' }, 'other-secret')}`;
    expect((await read(forged)).status).toBe(401);
  });

  it('refuses a save aimed at another account through a body field and changes nothing', async () => {
    const victim = await withPhone('victim');
    const attacker = await account('attacker');
    const res = await save(
      { accountId: victim, ...pick('DUE_ITP', 'sms') },
      bearer(attacker),
    );
    expect(res.status).toBe(400);
    expect(await stored(victim)).toEqual([]);
    expect(await stored(attacker)).toEqual([]);
  });
});

// @traces 142-FR-003
describe('the phone check of a save', () => {
  it('reads phoneVerified false for a confirmation time with no phone', async () => {
    const id = await account('odd');
    await prisma.account.update({
      data: { phone: null, phoneVerifiedAt: new Date() },
      where: { id },
    });
    expect((await read(bearer(id))).body.phoneVerified).toBe(false);
    const res = await save(pick('DUE_ITP', 'sms'), bearer(id));
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('phone_not_verified');
  });

  it('reads phoneVerified false for an empty phone with a confirmation time', async () => {
    const id = await account('empty');
    await prisma.account.update({
      data: { phone: '', phoneVerifiedAt: new Date() },
      where: { id },
    });
    expect((await read(bearer(id))).body.phoneVerified).toBe(false);
  });

  it('refuses a whole save when one of its choices needs the phone, writing none of it', async () => {
    const id = await account('batch');
    const res = await save(
      {
        groups: [{ enabled: false, key: 'offers' }],
        preferences: [
          {
            channel: 'push',
            enabled: true,
            garageId: null,
            type: 'QUOTE_RECEIVED',
          },
          { channel: 'sms', enabled: true, garageId: null, type: 'DUE_ITP' },
        ],
      },
      bearer(id),
    );
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('phone_not_verified');
    expect(await stored(id)).toEqual([]);
    expect(await audited(id)).toEqual([]);
  });

  it('refuses SMS for a type that is switched off in the same save', async () => {
    const id = await account('off');
    const res = await save(pick('DUE_ITP', 'sms', false), bearer(id));
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('phone_not_verified');
    expect(await stored(id)).toEqual([]);
  });

  it('does not count a pick that was refused', async () => {
    const id = await account('refused');
    const choices = jest.spyOn(counters, 'countChannelChoice');
    await save(pick('DUE_ITP', 'whatsapp'), bearer(id));
    expect(choices).not.toHaveBeenCalled();
    choices.mockRestore();
  });

  it('lets a confirmed phone pick SMS for every reminder type', async () => {
    const id = await withPhone('reminders');
    for (const type of [
      'BOOKING_REMINDER',
      'DUE_ITP',
      'DUE_RCA',
      'DUE_ROVINIETA',
      'TYRES_SEASON',
      'SERVICE_DUE',
    ]) {
      expect((await save(pick(type, 'sms'), bearer(id))).status).toBe(200);
    }
    expect((await stored(id)).map((r) => r.channel)).toEqual(
      Array(6).fill('sms'),
    );
  });

  it('keeps a saved SMS choice readable after the phone is unconfirmed, with phoneVerified false', async () => {
    const id = await withPhone('changed');
    await save(pick('DUE_ITP', 'sms'), bearer(id));
    await prisma.account.update({
      data: { phoneVerifiedAt: null },
      where: { id },
    });
    const res = await read(bearer(id));
    expect(res.body.phoneVerified).toBe(false);
    expect(channelOf(res.body, 'DUE_ITP')).toBe('sms');
  });

  it('refuses SMS for another type once the phone is unconfirmed, though one SMS choice was saved before', async () => {
    const id = await withPhone('later');
    await save(pick('DUE_ITP', 'sms'), bearer(id));
    await prisma.account.update({
      data: { phoneVerifiedAt: null },
      where: { id },
    });
    const res = await save(pick('DUE_RCA', 'sms'), bearer(id));
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('phone_not_verified');
  });
});

// @traces 142-FR-002
describe('malformed picks', () => {
  it.each([
    ['upper-case channel', pick('DUE_ITP', 'SMS')],
    ['unknown channel', pick('DUE_ITP', 'carrier-pigeon')],
    ['null channel', pick('DUE_ITP', null)],
    ['numeric channel', pick('DUE_ITP', 1)],
    ['string enabled', pick('DUE_ITP', 'email', 'true')],
    ['null enabled', pick('DUE_ITP', 'email', null)],
    ['type over 64 characters', pick('A'.repeat(65), 'email')],
    ['numeric type', pick(7 as unknown as string, 'email')],
    ['preferences that is not a list', { preferences: 'DUE_ITP' }],
    ['a null entry', { preferences: [null] }],
    [
      'an extra field on the entry',
      {
        preferences: [
          {
            channel: 'email',
            enabled: true,
            extra: 1,
            garageId: null,
            type: 'DUE_ITP',
          },
        ],
      },
    ],
    [
      'a missing garageId',
      { preferences: [{ channel: 'email', enabled: true, type: 'DUE_ITP' }] },
    ],
    [
      'a garageId that is not a UUID',
      {
        preferences: [
          { channel: 'email', enabled: true, garageId: 'abc', type: 'DUE_ITP' },
        ],
      },
    ],
  ])('answers 400 for %s and writes nothing', async (_name, body) => {
    const id = await withPhone('malformed');
    const res = await save(body, bearer(id));
    expect(res.status).toBe(400);
    expect(await stored(id)).toEqual([]);
  });

  it('answers a 4xx, never 500, for a type no catalogue entry has', async () => {
    const id = await account('unknown-type');
    const res = await save(pick('NOT_A_TYPE', 'email'), bearer(id));
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    expect(await stored(id)).toEqual([]);
  });

  it('answers a 4xx, never 500, for the prototype names as a type', async () => {
    const id = await account('proto');
    for (const type of [
      '__proto__',
      'constructor',
      'toString',
      'hasOwnProperty',
    ]) {
      const res = await save(pick(type, 'email'), bearer(id));
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.status).toBeLessThan(500);
    }
  });

  it('answers a 4xx for a lower-case type name', async () => {
    const id = await account('lower');
    const res = await save(pick('due_itp', 'email'), bearer(id));
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });

  it('answers a 4xx, with nothing stored, for a driver type carrying a garage the caller is not staff of', async () => {
    const id = await withPhone('foreign-garage');
    const garage = await prisma.garage.create({
      data: { name: 'g', slug: 'g-foreign' },
    });
    const res = await save(
      {
        preferences: [
          {
            channel: 'sms',
            enabled: true,
            garageId: garage.id,
            type: 'DUE_ITP',
          },
        ],
      },
      bearer(id),
    );
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    expect(await stored(id)).toEqual([]);
  });

  it('accepts 200 picks and refuses 201', async () => {
    const id = await withPhone('many');
    const list = (n: number) => ({
      preferences: Array.from({ length: n }, (_, i) => ({
        channel: i % 2 ? 'whatsapp' : 'sms',
        enabled: true,
        garageId: null,
        type: 'DUE_ITP',
      })),
    });
    expect((await save(list(201), bearer(id))).status).toBe(400);
    expect(await stored(id)).toEqual([]);
    const ok = await save(list(200), bearer(id));
    expect(ok.status).toBe(200);
    expect(channelOf(ok.body, 'DUE_ITP')).toBe('whatsapp');
    expect(await stored(id)).toHaveLength(1);
  });

  it('accepts an empty preferences list and an empty body without a change', async () => {
    const id = await account('empty-save');
    expect((await save({ preferences: [] }, bearer(id))).status).toBe(200);
    expect((await save({}, bearer(id))).status).toBe(200);
    expect(await audited(id)).toEqual([]);
    expect(await stored(id)).toEqual([]);
  });

  it('counts one pick per changed type, not per submitted entry', async () => {
    const id = await withPhone('counted');
    const choices = jest.spyOn(counters, 'countChannelChoice');
    await save(
      {
        preferences: [
          { channel: 'email', enabled: true, garageId: null, type: 'DUE_ITP' },
          { channel: 'sms', enabled: true, garageId: null, type: 'DUE_RCA' },
        ],
      },
      bearer(id),
    );
    expect(choices.mock.calls).toEqual([['sms']]);
    choices.mockRestore();
  });

  it('does not count a group switch as a channel pick', async () => {
    const id = await account('switch');
    const choices = jest.spyOn(counters, 'countChannelChoice');
    await save({ groups: [{ enabled: false, key: 'due_dates' }] }, bearer(id));
    expect(choices).not.toHaveBeenCalled();
    choices.mockRestore();
  });

  it('stays at one stored row and no server error when the same pick arrives ten times at once', async () => {
    const id = await withPhone('race');
    const answers = await Promise.all(
      Array.from({ length: 10 }, () =>
        save(pick('DUE_ITP', 'whatsapp'), bearer(id)),
      ),
    );
    expect(answers.map((a) => a.status)).toEqual(Array(10).fill(200));
    expect(await stored(id)).toHaveLength(1);
  });
});

// @traces 142-FR-005
describe('the push default on the read', () => {
  const device = (accountId: string, n = 1) =>
    prisma.pushSubscription.create({
      data: {
        accountId,
        auth: 'a',
        endpoint: `https://push.example.test/${accountId}/${n}`,
        label: 'l',
        p256dh: 'k',
      },
    });

  it('shows every mutable push type on push and the others on e-mail with a device', async () => {
    const id = await account('device');
    await device(id);
    const res = await read(bearer(id));
    expect(res.body.pushDevice).toBe(true);
    const wrong = res.body.preferences
      .filter(
        (p: {
          garageId: null;
          alwaysSent: boolean;
          channels: string[];
          channel: string;
          type: string;
        }) => p.garageId === null,
      )
      .filter(
        (p: {
          alwaysSent: boolean;
          channels: string[];
          channel: string;
          type: string;
        }) =>
          p.channel !==
          (!p.alwaysSent && p.channels.includes('push') && p.type !== 'NEWS'
            ? 'push'
            : 'email'),
      );
    expect(wrong).toEqual([]);
  });

  it('keeps an explicit e-mail pick on e-mail while a device exists', async () => {
    const id = await account('explicit');
    await device(id);
    await save(pick('DUE_ITP', 'email'), bearer(id));
    expect(channelOf((await read(bearer(id))).body, 'DUE_ITP')).toBe('email');
    expect(channelOf((await read(bearer(id))).body, 'DUE_RCA')).toBe('push');
  });

  it('records no audit entry for picking push when push is already the default', async () => {
    const id = await account('same');
    await device(id);
    const res = await save(pick('DUE_ITP', 'push'), bearer(id));
    expect(res.status).toBe(200);
    expect(await audited(id)).toEqual([]);
  });

  it('records the push default as the old value when e-mail is picked', async () => {
    const id = await account('old');
    await device(id);
    await save(pick('DUE_ITP', 'email'), bearer(id));
    const [entry] = await audited(id);
    expect(entry).toMatchObject({
      newValue: { channel: 'email', enabled: true },
      oldValue: { channel: 'push', enabled: true },
    });
  });

  it('falls back to e-mail on the next read after the last of several devices is deleted', async () => {
    const id = await account('devices');
    const first = await device(id, 1);
    const second = await device(id, 2);
    await prisma.pushSubscription.delete({ where: { id: first.id } });
    expect(channelOf((await read(bearer(id))).body, 'DUE_ITP')).toBe('push');
    await prisma.pushSubscription.delete({ where: { id: second.id } });
    const res = await read(bearer(id));
    expect(res.body.pushDevice).toBe(false);
    expect(channelOf(res.body, 'DUE_ITP')).toBe('email');
  });

  it('does not take another driver’s device as the caller’s', async () => {
    const other = await account('other');
    await device(other);
    const id = await account('mine');
    const res = await read(bearer(id));
    expect(res.body.pushDevice).toBe(false);
    expect(channelOf(res.body, 'DUE_ITP')).toBe('email');
  });

  it('does not turn a switched-off group on or change its channel when a device appears', async () => {
    const id = await account('off-then-device');
    await save({ groups: [{ enabled: false, key: 'due_dates' }] }, bearer(id));
    await device(id);
    const res = await read(bearer(id));
    expect(
      res.body.groups.find((g: { key: string }) => g.key === 'due_dates')
        .enabled,
    ).toBe(false);
  });

  it('reads NEWS on e-mail and off with a device', async () => {
    const id = await account('news');
    await device(id);
    const news = (await read(bearer(id))).body.preferences.find(
      (p: { type: string }) => p.type === 'NEWS',
    );
    expect(news).toMatchObject({
      channel: 'email',
      channels: ['email'],
      enabled: false,
    });
  });
});

// @traces 142-FR-004
describe('the SMS usage on the read', () => {
  const thisMonth = () =>
    new Intl.DateTimeFormat('en-CA', {
      month: '2-digit',
      timeZone: 'Europe/Bucharest',
      year: 'numeric',
    })
      .format(new Date())
      .slice(0, 7);

  it('reads used 0 and the cap 5 with no counter row', async () => {
    const id = await account('fresh');
    expect((await read(bearer(id))).body.sms).toEqual({ cap: 5, used: 0 });
  });

  it('reads the count of this month, below, at the cap and after it dropped to zero', async () => {
    const id = await account('counts');
    for (const sentCount of [1, 4, 5, 0]) {
      await prisma.smsCounter.upsert({
        create: { accountId: id, month: thisMonth(), sentCount },
        update: { sentCount },
        where: { accountId_month: { accountId: id, month: thisMonth() } },
      });
      expect((await read(bearer(id))).body.sms).toEqual({
        cap: 5,
        used: sentCount,
      });
    }
  });

  it('does not add the counters of earlier months', async () => {
    const id = await account('earlier');
    await prisma.smsCounter.createMany({
      data: [
        { accountId: id, month: '2026-01', sentCount: 5 },
        { accountId: id, month: '2025-12', sentCount: 5 },
      ],
    });
    expect((await read(bearer(id))).body.sms.used).toBe(0);
  });

  it('gives the same read to a second call and writes nothing', async () => {
    const id = await account('twice');
    const first = await read(bearer(id));
    const second = await read(bearer(id));
    expect(second.body).toEqual(first.body);
    expect(await prisma.smsCounter.count({ where: { accountId: id } })).toBe(0);
    expect(await stored(id)).toEqual([]);
  });
});
