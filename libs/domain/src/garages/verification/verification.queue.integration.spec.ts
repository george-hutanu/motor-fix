import { randomUUID } from 'node:crypto';

import { VerificationService } from './verification.service';
import { AuditService } from '../../audit/audit.service';
import type { Actor } from '../../auth/policy';
import { serialDatabase } from '../../auth/serial-db.testing';
import { outbox } from '../../events/event.port';
import type { Prisma } from '../../generated/prisma/client';
import {
  databaseUrl,
  fixtures,
} from '../../notifications/notifications.testing';

// @traces 301-FR-001 301-FR-002 301-FR-003 301-FR-004 301-FR-006 301-FR-011

const { account, prisma, reset } = fixtures();
serialDatabase(databaseUrl);

const NONE = {
  canAnswerQuotes: false,
  canMoveBookings: false,
  canRecordFinalPrice: false,
};
const service = () =>
  new VerificationService(new AuditService(), outbox, {
    skipManualApproval: false,
  });
const inTx = <T>(fn: (tx: Prisma.TransactionClient) => Promise<T>) =>
  prisma.$transaction(fn);
const page = (offset = 0, limit = 20) => ({ limit, offset });

let admin: Actor;
let owner: Actor;

beforeEach(async () => {
  await reset();
  admin = {
    accountId: await account('Ioana Popa', ['admin']),
    garageId: null,
    permissions: NONE,
    role: 'admin',
    roles: ['admin'],
  };
  owner = {
    accountId: await account('Mihai', ['garage']),
    garageId: null,
    permissions: NONE,
    role: 'garage',
    roles: ['garage'],
  };
});

afterAll(() => prisma.$disconnect());

const garage = (data: Partial<Prisma.GarageUncheckedCreateInput> = {}) =>
  prisma.garage.create({
    data: { name: 'Auto Vest Motors', slug: `g-${randomUUID()}`, ...data },
  });

// A file of a new garage, in `status`, sent at `submittedAt`.
async function waiting(
  submittedAt: Date,
  status:
    | 'submitted'
    | 'in_review'
    | 'more_requested'
    | 'approved'
    | 'rejected' = 'submitted',
  data: Partial<Prisma.GarageUncheckedCreateInput> = {},
) {
  const { id: garageId } = await garage(data);
  return prisma.verificationFile.create({
    data: { garageId, status, submittedAt },
  });
}

const brand = (name: string) =>
  prisma.brand.upsert({
    create: { key: `test-${name}`, name, slug: `test-${name}` },
    update: {},
    where: { name },
  });

// Thursday 15 October 2026, 10:01 in Bucharest.
const NOW = new Date('2026-10-15T10:01:00+03:00');
const MONDAY = new Date('2026-10-12T10:00:00+03:00');

describe('the files waiting for an admin', () => {
  it('lists submitted and in-review files only, oldest sending first', async () => {
    const late = await waiting(new Date('2026-10-14T09:00:00+03:00'));
    const early = await waiting(MONDAY, 'in_review');
    await waiting(MONDAY, 'more_requested');
    await waiting(MONDAY, 'approved');
    await waiting(MONDAY, 'rejected');

    const queue = await service().queue(prisma, page(), NOW);

    expect(queue.items.map((row) => row.id)).toEqual([early.id, late.id]);
    expect(queue.items.map((row) => row.status)).toEqual([
      'in_review',
      'submitted',
    ]);
    expect(queue.total).toBe(2);
  });

  it('answers the same total as the waiting count, on every page', async () => {
    for (let n = 0; n < 3; n++) await waiting(MONDAY);
    const verification = service();

    const first = await verification.queue(prisma, page(0, 2), NOW);
    const beyond = await verification.queue(prisma, page(10, 2), NOW);

    expect(first.items).toHaveLength(2);
    expect(beyond.items).toEqual([]);
    expect(first.total).toBe(3);
    expect(beyond.total).toBe(3);
    expect(await verification.countWaiting(prisma)).toBe(3);
  });

  it('keeps one order for files sent at the same instant', async () => {
    const a = await waiting(MONDAY);
    const b = await waiting(MONDAY);

    const queue = await service().queue(prisma, page(), NOW);

    expect(queue.items.map((row) => row.id)).toEqual(
      [a.id, b.id].sort().reverse(),
    );
  });

  it('orders a resent file by its resending', async () => {
    const resent = await waiting(
      new Date('2026-10-01T10:00:00+03:00'),
      'more_requested',
    );
    const other = await waiting(MONDAY);

    await inTx((tx) => service().resend(tx, owner, resent.id));
    const queue = await service().queue(prisma, page(), NOW);

    expect(queue.items.map((row) => row.id)).toEqual([other.id, resent.id]);
  });

  it('writes nothing when read', async () => {
    await waiting(MONDAY);
    const before = await prisma.activityLog.count();

    await service().queue(prisma, page(), NOW);

    expect(await prisma.activityLog.count()).toBe(before);
  });
});

describe('a row', () => {
  it('names the garage, its town, its brands and its mechanics', async () => {
    const file = await waiting(MONDAY, 'submitted', {
      cityKey: 'bucuresti',
      cityName: 'București',
    });
    const [dacia, ford, audi] = await Promise.all(
      ['Dacia', 'Ford', 'Audi'].map(brand),
    );
    await prisma.garageBrand.createMany({
      data: [
        { brandId: dacia.id, garageId: file.garageId, stance: 'works_on' },
        { brandId: ford.id, garageId: file.garageId, stance: 'works_on' },
        {
          brandId: audi.id,
          diesel: false,
          electric: false,
          garageId: file.garageId,
          hybrid: false,
          petrol: false,
          stance: 'does_not_take',
        },
      ],
    });
    await prisma.mechanic.createMany({
      data: ['Ion', 'Vlad', 'Ana'].map((name) => ({
        garageId: file.garageId,
        name,
      })),
    });

    const [row] = (await service().queue(prisma, page(), NOW)).items;

    expect(row).toMatchObject({
      area: { kind: 'town', name: 'București' },
      brands: 2,
      garageId: file.garageId,
      garageName: 'Auto Vest Motors',
      id: file.id,
      mechanics: 3,
      submittedAt: MONDAY,
    });
  });

  it("reads a mobile mechanic's radius as its area", async () => {
    await waiting(MONDAY, 'submitted', {
      businessKind: 'mobile',
      cityKey: 'bucuresti',
      cityName: 'București',
      serviceRadiusKm: 20,
    });

    const [row] = (await service().queue(prisma, page(), NOW)).items;

    expect(row.area).toEqual({ kind: 'mobile', radiusKm: 20 });
  });

  it('has no area without a town, and no mechanics when the team is off', async () => {
    const file = await waiting(MONDAY);
    await prisma.garageFeature.create({
      data: { enabled: false, garageId: file.garageId, key: 'team_mechanics' },
    });
    await prisma.mechanic.create({
      data: { garageId: file.garageId, name: 'Ion' },
    });

    const [row] = (await service().queue(prisma, page(), NOW)).items;

    expect(row.area).toBeUndefined();
    expect(row.mechanics).toBeUndefined();
    expect(row.brands).toBe(0);
  });

  it("carries the checks' summary in both languages", async () => {
    const file = await waiting(MONDAY);
    await prisma.verificationCheck.create({
      data: { fileId: file.id, kind: 'company', result: 'ok' },
    });

    const [row] = (await service().queue(prisma, page(), NOW)).items;

    expect(row.summary.ro).toMatch(/verificat/i);
    expect(row.summary.en).toMatch(/checked/i);
  });

  it('flags a file waiting more than 2 working days, amber unless a check failed', async () => {
    const late = await waiting(MONDAY);
    const failed = await waiting(MONDAY);
    await prisma.verificationCheck.create({
      data: {
        detail: 'radiată',
        fileId: failed.id,
        kind: 'company',
        result: 'failed',
      },
    });
    await waiting(new Date('2026-10-13T10:00:00+03:00'));

    const rows = (await service().queue(prisma, page(), NOW)).items;
    const byId = new Map(rows.map((row) => [row.id, row]));

    expect(byId.get(late.id)).toMatchObject({
      flagged: true,
      lamp: 'amber',
      workingDays: 3,
    });
    expect(byId.get(failed.id)).toMatchObject({
      flagged: true,
      lamp: 'red',
      workingDays: 3,
    });
    expect(rows[2]).toMatchObject({
      flagged: false,
      lamp: 'grey',
      workingDays: 2,
    });
  });
});

describe('the time of the latest sending', () => {
  it('is set at submitting, kept at opening and deciding', async () => {
    const { id: garageId } = await garage();
    const verification = service();
    const before = Date.now();

    const file = await inTx((tx) => verification.submit(tx, owner, garageId));
    expect(file.submittedAt.getTime()).toBeGreaterThanOrEqual(before - 1000);

    await inTx((tx) => verification.open(tx, admin, file.id));
    await inTx((tx) =>
      verification.decide(tx, admin, file.id, {
        outcome: 'more_requested',
        reason: { code: 'documents_unreadable', note: 'Blurred' },
      }),
    );
    const decided = await prisma.verificationFile.findUniqueOrThrow({
      where: { id: file.id },
    });
    expect(decided.submittedAt).toEqual(file.submittedAt);
  });

  it('is reset by a resending and by a reopening', async () => {
    const old = new Date('2026-09-01T10:00:00+03:00');
    const asked = await waiting(old, 'more_requested');
    const decided = await waiting(old, 'rejected');

    const resent = await inTx((tx) => service().resend(tx, owner, asked.id));
    const reopened = await inTx((tx) =>
      service().reopen(tx, admin, decided.id),
    );

    expect(resent.submittedAt.getTime()).toBeGreaterThan(old.getTime());
    expect(reopened.submittedAt.getTime()).toBeGreaterThan(old.getTime());
  });
});
