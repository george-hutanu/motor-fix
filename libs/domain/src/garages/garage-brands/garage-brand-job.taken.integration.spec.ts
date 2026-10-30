import { randomUUID } from 'node:crypto';

import { GarageBrandsService } from './garage-brands.service';
import { AuditService } from '../../audit/audit.service';
import type { Actor } from '../../auth/policy';
import { serialDatabase } from '../../auth/serial-db.testing';
import { noEvents } from '../../events/event.port';
import {
  databaseUrl,
  fixtures,
} from '../../notifications/notifications.testing';

// @traces 1247-FR-007

const { account, prisma, reset } = fixtures();
const brands = new GarageBrandsService(prisma, new AuditService(), noEvents);
serialDatabase(databaseUrl);

let garageId: string;
let brandId: string;
let jobTypeId: string;
const created: string[] = [];

beforeEach(async () => {
  await reset();
  await prisma.$executeRawUnsafe('TRUNCATE brand CASCADE');
  const key = `dacia-${randomUUID()}`;
  ({ id: brandId } = await prisma.brand.create({
    data: { key, name: key, slug: key },
  }));
  ({ id: garageId } = await prisma.garage.create({
    data: { name: 'Service Auto Nord', slug: `nord-${randomUUID()}` },
  }));
  const job = `taken-${randomUUID()}`;
  ({ id: jobTypeId } = await prisma.jobType.create({
    data: { key: job, nameEn: job, nameRo: job, status: 'approved' },
  }));
  created.push(jobTypeId);
});

afterAll(async () => {
  await reset();
  await prisma.jobType.deleteMany({ where: { id: { in: created } } });
  await prisma.$disconnect();
});

const stance = (value: 'works_on' | 'does_not_take') =>
  prisma.garageBrand.create({ data: { brandId, garageId, stance: value } });

const tick = () =>
  prisma.$executeRawUnsafe(
    'INSERT INTO "garage_brand_job" ("garage_id", "brand_id", "job_type_id") VALUES ($1::uuid, $2::uuid, $3::uuid)',
    garageId,
    brandId,
    jobTypeId,
  );

const ticks = () => prisma.garageBrandJob.count({ where: { garageId } });

describe('a job tick only on a brand the garage takes', () => {
  it('refuses a tick on a brand the garage does not take', async () => {
    await stance('does_not_take');

    await expect(tick()).rejects.toThrow(/garage_brand_job_taken/);
    expect(await ticks()).toBe(0);
  });

  it('keeps a tick on a brand the garage works on', async () => {
    await stance('works_on');

    await tick();

    expect(await ticks()).toBe(1);
  });

  it('leaves a tick on a brand with no stance to the composite foreign key', async () => {
    await expect(tick()).rejects.toThrow(
      /garage_brand_job_garage_id_brand_id_fkey/,
    );
  });

  it('still clears the ticks when the owner stops taking the brand', async () => {
    const owner = await account('Mihai Ionescu', ['garage']);
    await prisma.garageMember.create({
      data: { accountId: owner, garageId, role: 'owner' },
    });
    const actor: Actor = {
      accountId: owner,
      garageId,
      permissions: {
        canAnswerQuotes: false,
        canMoveBookings: false,
        canRecordFinalPrice: false,
      },
      role: 'garage',
      roles: ['garage'],
    };
    await stance('works_on');
    await tick();

    await prisma.$transaction((tx) =>
      brands.setStance(tx, actor, garageId, brandId, 'does_not_take'),
    );

    expect(await ticks()).toBe(0);
  });
});
