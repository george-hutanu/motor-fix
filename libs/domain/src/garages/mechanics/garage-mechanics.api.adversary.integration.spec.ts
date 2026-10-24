import { randomUUID } from 'node:crypto';

import { ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';

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

beforeEach(() => reset());

const bearer = (accountId: string, role: Role) =>
  `Bearer ${signAccessToken({ accountId, role }, tokenSecret)}`;
const team = (garageId: string, auth?: string) => {
  const call = request(app.getHttpServer()).get(
    `/garages/${garageId}/mechanics`,
  );
  return auth ? call.set('Authorization', auth) : call;
};

// Atelier Dinamo: its owner Mihai (who has a card of his own), a receptionist,
// a mechanic with an account, and cards with none; Atelier Nord with its owner.
async function world() {
  const dinamo = await prisma.garage.create({
    data: { name: 'Atelier Dinamo', slug: `dinamo-${randomUUID()}` },
  });
  const nord = await prisma.garage.create({
    data: { name: 'Atelier Nord', slug: `nord-${randomUUID()}` },
  });
  const mihai = await account('mihai', ['garage', 'mechanic']);
  await prisma.garageMember.create({
    data: { accountId: mihai, garageId: dinamo.id, role: 'owner' },
  });
  await prisma.mechanic.create({
    data: { accountId: mihai, garageId: dinamo.id, name: 'Mihai Pop' },
  });
  const ioana = await account('ioana', ['receptionist']);
  await prisma.garageMember.create({
    data: { accountId: ioana, garageId: dinamo.id, role: 'receptionist' },
  });
  const vlad = await account('vlad', ['mechanic']);
  const vladCard = await prisma.mechanic.create({
    data: {
      accountId: vlad,
      garageId: dinamo.id,
      name: 'Tudor Vlad',
      onProfile: true,
      rating: 4.9,
      reviewCount: 58,
      speciality: 'Frâne, suspensie',
    },
  });
  const radu = await account('radu', ['garage']);
  await prisma.garageMember.create({
    data: { accountId: radu, garageId: nord.id, role: 'owner' },
  });
  return { dinamo, ioana, mihai, nord, radu, vlad, vladCard };
}

const card = (garageId: string, name: string, extra: object = {}) =>
  prisma.mechanic.create({ data: { garageId, name, ...extra } });

const switchOff = (garageId: string) =>
  prisma.garageFeature.create({
    data: { enabled: false, garageId, key: 'team_mechanics' },
  });

const names = (res: request.Response) =>
  (res.body.items as { name: string }[]).map((i) => i.name);

// @traces 055-FR-001
describe('the team list under awkward cards', () => {
  it('orders names that differ only by case or diacritics by id, and the same on every read', async () => {
    const { dinamo, mihai } = await world();
    const made = [];
    for (const name of [
      'ana pop',
      'Ana Pop',
      'ANA POP',
      'Ană Pop',
      'Ana  Pop',
    ]) {
      made.push(await card(dinamo.id, name));
    }
    const first = await team(dinamo.id, bearer(mihai, 'garage'));
    const second = await team(dinamo.id, bearer(mihai, 'garage'));

    expect(second.body).toEqual(first.body);
    const equalGroup = (first.body.items as { id: string; name: string }[])
      .filter((i) => /^ana pop$/i.test(i.name))
      .map((i) => i.id);
    expect(equalGroup).toEqual([...equalGroup].sort());
  });

  it('puts stan before Ștefan before Tudor whatever order they were created in', async () => {
    const { dinamo, mihai, vlad } = await world();
    await prisma.mechanic.delete({ where: { accountId: vlad } });
    await card(dinamo.id, 'Tudor Ilie');
    await card(dinamo.id, 'Ștefan Ilie');
    await card(dinamo.id, 'stan Ilie');
    await card(dinamo.id, 'Ábel Ilie');
    await card(dinamo.id, 'Zoe Ilie');

    const res = await team(dinamo.id, bearer(mihai, 'garage'));

    expect(names(res)).toEqual([
      'Ábel Ilie',
      'stan Ilie',
      'Ștefan Ilie',
      'Tudor Ilie',
      'Zoe Ilie',
    ]);
  });

  it('answers every one of three hundred cards in one read', async () => {
    const { dinamo, mihai } = await world();
    await prisma.mechanic.createMany({
      data: Array.from({ length: 300 }, (_, i) => ({
        garageId: dinamo.id,
        name: `Mecanic ${String(i).padStart(3, '0')}`,
      })),
    });

    const res = await team(dinamo.id, bearer(mihai, 'garage'));

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(301);
    expect(names(res).slice(0, 3)).toEqual([
      'Mecanic 000',
      'Mecanic 001',
      'Mecanic 002',
    ]);
  });

  it('keeps the extreme ratings and a huge count as written', async () => {
    const { dinamo, mihai, vlad } = await world();
    await prisma.mechanic.delete({ where: { accountId: vlad } });
    await card(dinamo.id, 'A Top', { rating: 5, reviewCount: 100000 });
    await card(dinamo.id, 'B Low', { rating: 1, reviewCount: 1 });

    const res = await team(dinamo.id, bearer(mihai, 'garage'));

    expect(
      res.body.items.map((i: { rating: string; reviewCount: number }) => [
        i.rating,
        i.reviewCount,
      ]),
    ).toEqual([
      ['5.0', 100000],
      ['1.0', 1],
    ]);
  });

  it('hands markup and emoji in a name back as the text it is', async () => {
    const { dinamo, mihai, vlad } = await world();
    await prisma.mechanic.delete({ where: { accountId: vlad } });
    await card(dinamo.id, '<script>alert(1)</script>', {
      speciality: '"; DROP TABLE mechanic; --',
    });

    const res = await team(dinamo.id, bearer(mihai, 'garage'));

    expect(res.body.items[0]).toMatchObject({
      name: '<script>alert(1)</script>',
      speciality: '"; DROP TABLE mechanic; --',
    });
  });

  it('leaves out a removed card whatever its profile mark and figures', async () => {
    const { dinamo, mihai, vlad } = await world();
    await prisma.mechanic.delete({ where: { accountId: vlad } });
    await card(dinamo.id, 'Gone Fast', {
      onProfile: true,
      rating: 4.5,
      removedAt: new Date(0),
      reviewCount: 9,
    });

    const res = await team(dinamo.id, bearer(mihai, 'garage'));

    expect(res.body).toEqual({ items: [] });
  });

  it("leaves out the owner's own card even when it sits on the profile with reviews", async () => {
    const { dinamo, mihai, vlad } = await world();
    await prisma.mechanic.delete({ where: { accountId: vlad } });
    await prisma.mechanic.update({
      data: { onProfile: true, rating: 4.2, reviewCount: 12 },
      where: { accountId: mihai },
    });

    const res = await team(dinamo.id, bearer(mihai, 'garage'));

    expect(res.body).toEqual({ items: [] });
  });

  it('ignores a garageId in the query string and reads the one in the path', async () => {
    const { dinamo, mihai, nord } = await world();
    await card(nord.id, 'Only Nord');

    const res = await request(app.getHttpServer())
      .get(`/garages/${dinamo.id}/mechanics?garageId=${nord.id}`)
      .set('Authorization', bearer(mihai, 'garage'));

    expect(res.status).toBe(200);
    expect(names(res)).toEqual(['Tudor Vlad']);
  });

  it('answers an upper-case garage id like the lower-case one', async () => {
    const { dinamo, mihai } = await world();

    const res = await team(dinamo.id.toUpperCase(), bearer(mihai, 'garage'));

    expect(res.status).toBe(200);
    expect(names(res)).toEqual(['Tudor Vlad']);
  });
});

// @traces 055-FR-002 055-FR-003
describe('who reads the team, under awkward callers', () => {
  it('answers 404 not_found to the owner and to an admin for a garage that does not exist', async () => {
    const { mihai } = await world();
    const admin = await account('admin', ['admin']);

    for (const auth of [bearer(mihai, 'garage'), bearer(admin, 'admin')]) {
      const res = await team(randomUUID(), auth);
      expect([res.status, res.body.code]).toEqual([404, 'not_found']);
    }
  });

  it('answers a card holder of another role 404 when their account is no member of the garage', async () => {
    const { dinamo, radu } = await world();
    await card(dinamo.id, 'Radu Guest', { accountId: radu });

    const res = await team(dinamo.id, bearer(radu, 'garage'));

    expect([res.status, res.body.code]).toEqual([404, 'not_found']);
  });

  it('answers a former owner 404 once the membership is gone', async () => {
    const { dinamo, mihai } = await world();
    await prisma.garageMember.deleteMany({ where: { accountId: mihai } });

    const res = await team(dinamo.id, bearer(mihai, 'garage'));

    expect([res.status, res.body.code]).toEqual([404, 'not_found']);
  });

  it('answers 401 to a malformed bearer token and to a token signed with another secret', async () => {
    const { dinamo, mihai } = await world();
    const forged = `Bearer ${signAccessToken({ accountId: mihai, role: 'garage' }, 'other-secret')}`;

    for (const auth of ['Bearer nonsense', forged, 'Basic abc']) {
      expect((await team(dinamo.id, auth)).status).toBe(401);
    }
  });

  it('answers the owner 200 when the team switch is stored as on', async () => {
    const { dinamo, mihai } = await world();
    await prisma.garageFeature.create({
      data: { enabled: true, garageId: dinamo.id, key: 'team_mechanics' },
    });

    expect((await team(dinamo.id, bearer(mihai, 'garage'))).status).toBe(200);
  });

  it('keeps answering the team when a different feature is switched off', async () => {
    const { dinamo, mihai } = await world();
    await prisma.garageFeature.create({
      data: { enabled: false, garageId: dinamo.id, key: 'whatsapp' },
    });

    expect((await team(dinamo.id, bearer(mihai, 'garage'))).status).toBe(200);
  });

  it('answers the feature_off refusal with the same body on every call', async () => {
    const { dinamo, mihai } = await world();
    await switchOff(dinamo.id);

    const a = await team(dinamo.id, bearer(mihai, 'garage'));
    const b = await team(dinamo.id, bearer(mihai, 'garage'));

    expect([a.status, b.status]).toEqual([404, 404]);
    expect(b.body).toEqual(a.body);
    expect(JSON.stringify(a.body)).not.toContain('Tudor Vlad');
  });
});
