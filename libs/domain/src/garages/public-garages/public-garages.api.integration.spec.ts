import { randomUUID } from 'node:crypto';

import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AuthModule } from '../../auth/auth.module';
import { serialDatabase } from '../../auth/serial-db.testing';
import { NotificationsModule } from '../../notifications/notifications.module';
import {
  databaseUrl,
  fixtures,
  redisUrlFor,
  testConfig,
} from '../../notifications/notifications.testing';
import { GaragesModule } from '../garages.module';
import { VerificationService } from '../verification/verification.service';

// @traces 207-FR-005 207-FR-011 040-FR-012

const redisUrl = redisUrlFor(2);
const { account, prisma, reset } = fixtures();
serialDatabase(databaseUrl);

let app: NestExpressApplication;
let verification: VerificationService;

beforeAll(async () => {
  const email = testConfig('http://127.0.0.1:9');
  const auth = AuthModule.register({
    databaseUrl,
    redisUrl,
    tokenSecret: 'test-secret',
  });
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
  await app.init();
  verification = app.get(VerificationService);
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

beforeEach(async () => {
  await reset();
  await prisma.$executeRawUnsafe('TRUNCATE brand CASCADE');
});

const read = (slug: string) =>
  request(app.getHttpServer()).get(`/garages/${slug}`);

async function garage(status: 'draft' | 'approved' | 'suspended' = 'draft') {
  return prisma.garage.create({
    data: {
      name: 'Atelier Dinamo',
      slug: `dinamo-${randomUUID()}`,
      status,
    },
  });
}

async function withFile(
  status: 'submitted' | 'in_review' | 'more_requested' | 'rejected',
) {
  const created = await garage();
  await prisma.verificationFile.create({
    data: { garageId: created.id, status },
  });
  return created;
}

describe('reading a garage by its public slug', () => {
  it('returns an approved garage without a session', async () => {
    const approved = await garage('approved');

    const res = await read(approved.slug);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      brandNote: null,
      doesNotTake: [],
      id: approved.id,
      name: 'Atelier Dinamo',
      paymentMethods: { card: false, cash: false, transfer: false },
      refusalPhrase: null,
      slug: approved.slug,
      worksOn: [],
    });
  });

  it('never shows the phone, the step-1 details or the mechanic cards', async () => {
    const approved = await prisma.garage.create({
      data: {
        businessKind: 'company',
        knownFor: 'Frâne',
        name: 'Atelier Dinamo',
        phone: '+40722123456',
        slug: `dinamo-${randomUUID()}`,
        status: 'approved',
      },
    });
    await prisma.mechanic.create({
      data: { garageId: approved.id, name: 'Ion Marin', onProfile: true },
    });

    const res = await read(approved.slug);

    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual([
      'brandNote',
      'doesNotTake',
      'id',
      'name',
      'paymentMethods',
      'refusalPhrase',
      'slug',
      'worksOn',
    ]);
    expect(JSON.stringify(res.body)).not.toContain('722123456');
  });

  it('shows a workshop where it is', async () => {
    const approved = await prisma.garage.create({
      data: {
        address: 'Strada Ștefan cel Mare 12, Sector 2, București',
        businessKind: 'company',
        latitude: 44.4512,
        longitude: 26.1207,
        name: 'Atelier Dinamo',
        slug: `dinamo-${randomUUID()}`,
        status: 'approved',
      },
    });

    const res = await read(approved.slug);

    expect(res.body).toMatchObject({
      address: 'Strada Ștefan cel Mare 12, Sector 2, București',
      latitude: 44.4512,
      longitude: 26.1207,
    });
    expect(res.body).not.toHaveProperty('serviceRadiusKm');
  });

  it('shows a mobile mechanic only by the area served, never the seat', async () => {
    const seat = 'Strada Sediului 3, Ploiești';
    const approved = await prisma.garage.create({
      data: {
        businessKind: 'mobile',
        latitude: 44.9365,
        longitude: 26.0129,
        mobileLegalForm: 'pfa',
        name: 'Mecanic la domiciliu',
        seatAddress: seat,
        serviceRadiusKm: 35,
        slug: `mobil-${randomUUID()}`,
        status: 'approved',
      },
    });

    const res = await read(approved.slug);

    expect(res.status).toBe(200);
    expect(res.body.serviceRadiusKm).toBe(35);
    for (const key of ['address', 'latitude', 'longitude', 'seatAddress']) {
      expect(res.body).not.toHaveProperty(key);
    }
    const body = JSON.stringify(res.body);
    expect(body).not.toContain('Sediului');
    expect(body).not.toContain('44.9365');
  });

  it("carries the garage's brand answer, in catalogue order, retired brands kept", async () => {
    const approved = await prisma.garage.update({
      data: {
        brandNote: 'Fără mașini electrice',
        refusalPhrase: 'orice nu e BMW',
      },
      where: { id: (await garage('approved')).id },
    });
    const brand = (name: string, popularity: number | null, active = true) => {
      const key = `${name.toLowerCase()}-${randomUUID()}`;
      return prisma.brand.create({
        data: { active, key, name, popularity, slug: key },
      });
    };
    const bmw = await brand('BMW', 2);
    const audi = await brand('Audi', null);
    const mini = await brand('Mini', 1);
    const lada = await brand('Lada', null, false);
    const tesla = await brand('Tesla', 3);
    for (const [b, stance] of [
      [bmw, 'works_on'],
      [audi, 'works_on'],
      [mini, 'works_on'],
      [lada, 'works_on'],
      [tesla, 'does_not_take'],
    ] as const) {
      const fuels = stance === 'works_on';
      await prisma.garageBrand.create({
        data: {
          brandId: b.id,
          diesel: fuels,
          electric: fuels,
          garageId: approved.id,
          hybrid: fuels,
          petrol: fuels,
          stance,
        },
      });
    }

    const res = await read(approved.slug);

    const ref = (b: { id: string; name: string; slug: string }) => ({
      id: b.id,
      name: b.name,
      slug: b.slug,
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      brandNote: 'Fără mașini electrice',
      doesNotTake: [ref(tesla)],
      refusalPhrase: 'orice nu e BMW',
      worksOn: [ref(mini), ref(bmw), ref(audi), ref(lada)],
    });
  });

  it('carries the payment methods the garage takes', async () => {
    const approved = await garage('approved');
    await prisma.$executeRaw`UPDATE garage SET payment_cash = true, payment_transfer = true WHERE id = ${approved.id}::uuid`;

    const res = await read(approved.slug);

    expect(res.body.paymentMethods).toEqual({
      card: false,
      cash: true,
      transfer: true,
    });
  });

  it('carries no courtesy car when the garage does not list one', async () => {
    const approved = await garage('approved');

    const res = await read(approved.slug);

    expect(res.body).not.toHaveProperty('courtesyCar');
  });

  it('carries a free courtesy car without a price', async () => {
    const approved = await garage('approved');
    await prisma.garageFacility.create({
      data: { facility: 'courtesy_car', garageId: approved.id },
    });

    const res = await read(approved.slug);

    expect(res.body.courtesyCar).toEqual({ paid: false });
  });

  it('carries a paid courtesy car with its price per day', async () => {
    const approved = await garage('approved');
    await prisma.garageFacility.create({
      data: { facility: 'courtesy_car', garageId: approved.id },
    });
    await prisma.$executeRaw`UPDATE garage SET courtesy_car_paid = true, courtesy_car_price_per_day_bani = 12000 WHERE id = ${approved.id}::uuid`;

    const res = await read(approved.slug);

    expect(res.body.courtesyCar).toEqual({
      paid: true,
      pricePerDayBani: 12000,
    });
  });

  it('carries the ticked fuels of each taken brand, none ticked included', async () => {
    const approved = await garage('approved');
    const brand = (name: string, popularity: number) => {
      const key = `${name.toLowerCase()}-${randomUUID()}`;
      return prisma.brand.create({
        data: { key, name, popularity, slug: key },
      });
    };
    const dacia = await brand('Dacia', 1);
    const bmw = await brand('BMW', 2);
    const tesla = await brand('Tesla', 3);
    await prisma.garageBrand.createMany({
      data: [
        {
          brandId: dacia.id,
          diesel: true,
          electric: false,
          garageId: approved.id,
          hybrid: true,
          petrol: true,
          stance: 'works_on',
        },
        {
          brandId: bmw.id,
          diesel: false,
          electric: false,
          garageId: approved.id,
          hybrid: false,
          petrol: false,
          stance: 'works_on',
        },
        {
          brandId: tesla.id,
          diesel: false,
          electric: false,
          garageId: approved.id,
          hybrid: false,
          petrol: false,
          stance: 'does_not_take',
        },
      ],
    });

    const res = await read(approved.slug);

    expect(res.body.worksOn).toEqual([
      {
        fuels: ['petrol', 'diesel', 'hybrid'],
        id: dacia.id,
        name: 'Dacia',
        slug: dacia.slug,
      },
      { fuels: [], id: bmw.id, name: 'BMW', slug: bmw.slug },
    ]);
    expect(res.body.doesNotTake).toEqual([
      { id: tesla.id, name: 'Tesla', slug: tesla.slug },
    ]);
  });

  it('answers a garage never approved exactly as a slug nobody holds', async () => {
    const unknown = await read(`nobody-${randomUUID()}`);
    expect(unknown.status).toBe(404);
    expect(unknown.body.code).toBe('not_found');

    const hidden = [
      await garage('draft'),
      await withFile('submitted'),
      await withFile('in_review'),
      await withFile('more_requested'),
      await withFile('rejected'),
    ];
    for (const { slug } of hidden) {
      const res = await read(slug);

      expect([slug, res.status, res.body]).toEqual([slug, 404, unknown.body]);
    }
  });

  it('answers 410 gone for a suspended garage', async () => {
    const suspended = await garage('suspended');

    const res = await read(suspended.slug);

    expect(res.status).toBe(410);
    expect(res.body.code).toBe('gone');
  });

  it('returns the garage on the read right after its approval commits', async () => {
    const owner = await account('Mihai', ['garage']);
    const admin = await account('Ioana', ['admin']);
    const hidden = await garage();
    const none = {
      canAnswerQuotes: false,
      canMoveBookings: false,
      canRecordFinalPrice: false,
    };
    const file = await prisma.$transaction((tx) =>
      verification.submit(
        tx,
        {
          accountId: owner,
          garageId: hidden.id,
          permissions: none,
          role: 'garage',
          roles: ['garage'],
        },
        hidden.id,
      ),
    );
    expect((await read(hidden.slug)).status).toBe(404);

    await prisma.$transaction((tx) =>
      verification.decide(
        tx,
        {
          accountId: admin,
          garageId: null,
          permissions: none,
          role: 'admin',
          roles: ['admin'],
        },
        file.id,
        { outcome: 'approved' },
      ),
    );

    const res = await read(hidden.slug);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(hidden.id);
  });
});
