import { NEWS_CONSENT_TEXT_VERSION } from '@motor-fix/contracts';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { signAccessToken } from '../../auth/access-token';
import { AuthModule } from '../../auth/auth.module';
import { serialDatabase } from '../../auth/serial-db.testing';
import { NotificationsModule } from '../notifications.module';
import {
  databaseUrl,
  fixtures,
  redisUrlFor,
  testConfig,
} from '../notifications.testing';

const redisUrl = redisUrlFor(7);
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

beforeEach(() => reset());

const bearer = (accountId: string) =>
  `Bearer ${signAccessToken({ accountId, role: 'driver' }, tokenSecret)}`;

const read = (driver: string) =>
  request(app.getHttpServer())
    .get('/notification-preferences')
    .set('Authorization', bearer(driver));

const save = (driver: string, body: object) =>
  request(app.getHttpServer())
    .put('/notification-preferences')
    .set('Authorization', bearer(driver))
    .send(body);

const newsOn = { enabled: true, key: 'news' };
const newsOff = { enabled: false, key: 'news' };
const withConsent = (body: object) => ({
  ...body,
  newsConsentTextVersion: NEWS_CONSENT_TEXT_VERSION,
});

const newsRow = (accountId: string) =>
  prisma.notificationPreference.findFirst({
    where: { accountId, type: 'NEWS' },
  });

const consentEntries = (accountId: string) =>
  prisma.activityLog.findMany({
    orderBy: { at: 'asc' },
    where: { field: 'news_consent', subjectId: accountId },
  });

const newsGroup = (body: { groups: { key: string; enabled: boolean }[] }) =>
  body.groups.find((g) => g.key === 'news')?.enabled;

describe('a new driver', () => {
  it('reads news off, no consent, and the consent text version to show', async () => {
    const driver = await account('andrei');
    const res = await read(driver);
    expect(res.status).toBe(200);
    expect(newsGroup(res.body)).toBe(false);
    expect(res.body.newsConsent).toEqual({
      currentTextVersion: NEWS_CONSENT_TEXT_VERSION,
      givenAt: null,
      state: 'none',
      textVersion: null,
      withdrawnAt: null,
    });
  });
});

describe('turning news on', () => {
  it('records the consent: when, which text and where', async () => {
    const driver = await account('andrei');
    const before = Date.now();
    const res = await save(driver, withConsent({ groups: [newsOn] }));
    expect(res.status).toBe(200);
    expect(newsGroup(res.body)).toBe(true);
    expect(res.body.newsConsent).toMatchObject({
      state: 'given',
      textVersion: NEWS_CONSENT_TEXT_VERSION,
      withdrawnAt: null,
    });
    const row = await newsRow(driver);
    expect(row).toMatchObject({
      channel: 'email',
      consentSource: 'settings',
      consentTextVersion: NEWS_CONSENT_TEXT_VERSION,
      enabled: true,
      withdrawnAt: null,
    });
    expect(row?.consentGivenAt?.getTime()).toBeGreaterThanOrEqual(before);
    const [entry] = await consentEntries(driver);
    expect(entry).toMatchObject({
      actorId: driver,
      newValue: {
        state: 'given',
        textVersion: NEWS_CONSENT_TEXT_VERSION,
        via: 'settings',
      },
    });
  });

  it('records it as well when the type is chosen instead of the group', async () => {
    const driver = await account('andrei');
    const res = await save(
      driver,
      withConsent({
        preferences: [
          { channel: 'email', enabled: true, garageId: null, type: 'NEWS' },
        ],
      }),
    );
    expect(res.status).toBe(200);
    expect(res.body.newsConsent.state).toBe('given');
  });

  it.each([
    ['without the consent text version', {}],
    [
      'with a version that is not the current one',
      { newsConsentTextVersion: '2020-01-01' },
    ],
  ])('is refused %s, and nothing changes', async (_, extra) => {
    const driver = await account('andrei');
    const res = await save(driver, {
      groups: [newsOn, { enabled: false, key: 'offers' }],
      ...extra,
    });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('news_consent_required');
    expect(
      await prisma.notificationPreference.count({
        where: { accountId: driver },
      }),
    ).toBe(0);
    expect(await consentEntries(driver)).toEqual([]);
  });

  it('needs no version when news is already on, and records nothing again', async () => {
    const driver = await account('andrei');
    await save(driver, withConsent({ groups: [newsOn] }));
    const given = (await newsRow(driver))?.consentGivenAt;
    const res = await save(driver, { groups: [newsOn] });
    expect(res.status).toBe(200);
    expect((await newsRow(driver))?.consentGivenAt).toEqual(given);
    expect(await consentEntries(driver)).toHaveLength(1);
  });

  it('needs no version for a save that leaves news off', async () => {
    const driver = await account('andrei');
    const res = await save(driver, {
      groups: [{ enabled: false, key: 'offers' }],
    });
    expect(res.status).toBe(200);
  });
});

describe('turning news off', () => {
  it('withdraws the consent and keeps when and to which text it was given', async () => {
    const driver = await account('andrei');
    await save(driver, withConsent({ groups: [newsOn] }));
    const given = (await newsRow(driver))?.consentGivenAt;
    const res = await save(driver, { groups: [newsOff] });
    expect(res.status).toBe(200);
    expect(newsGroup(res.body)).toBe(false);
    expect(res.body.newsConsent).toMatchObject({
      state: 'withdrawn',
      textVersion: NEWS_CONSENT_TEXT_VERSION,
    });
    const row = await newsRow(driver);
    expect(row).toMatchObject({ enabled: false });
    expect(row?.consentGivenAt).toEqual(given);
    expect(row?.withdrawnAt).toBeInstanceOf(Date);
    const entries = await consentEntries(driver);
    expect(entries).toHaveLength(2);
    expect(entries[1]).toMatchObject({
      newValue: { state: 'withdrawn', via: 'settings' },
    });
  });

  it('leaves every other group as it was', async () => {
    const driver = await account('andrei');
    await save(driver, withConsent({ groups: [newsOn] }));
    const res = await save(driver, { groups: [newsOff] });
    const others = res.body.groups.filter(
      (g: { key: string }) => g.key !== 'news',
    );
    expect(others.every((g: { enabled: boolean }) => g.enabled)).toBe(true);
  });

  it('gives consent again, with a new time, when turned back on', async () => {
    const driver = await account('andrei');
    await save(driver, withConsent({ groups: [newsOn] }));
    const first = (await newsRow(driver))?.consentGivenAt;
    await save(driver, { groups: [newsOff] });
    await new Promise((resolve) => setTimeout(resolve, 5));
    const res = await save(driver, withConsent({ groups: [newsOn] }));
    expect(res.body.newsConsent.state).toBe('given');
    const row = await newsRow(driver);
    expect(row?.withdrawnAt).toBeNull();
    expect(row?.consentGivenAt?.getTime()).toBeGreaterThan(first!.getTime());
  });
});
