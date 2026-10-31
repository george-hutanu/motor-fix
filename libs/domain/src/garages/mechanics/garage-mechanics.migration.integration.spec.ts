import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { serialDatabase } from '../../auth/serial-db.testing';
import {
  databaseUrl,
  fixtures,
} from '../../notifications/notifications.testing';
import { shownOnProfile } from '../public-garages/public-garages';

const { account, prisma } = fixtures();
serialDatabase(databaseUrl);

const MIGRATION = join(
  __dirname,
  '../../../prisma/migrations/20261025120000_mechanic_card_fields/migration.sql',
);

// The database under test is already migrated, so only the migration's data
// statements can be run again over rows seeded after it.
const backfill = () =>
  readFileSync(MIGRATION, 'utf8')
    .split(/;\s*$/m)
    .map((sql) => sql.replace(/--.*$/gm, '').trim())
    .filter((sql) => /^(UPDATE|INSERT)\b/i.test(sql));

const runBackfill = async () => {
  const statements = backfill();
  expect(statements.length).toBeGreaterThanOrEqual(2);
  for (const sql of statements) await prisma.$executeRawUnsafe(sql);
};

const HOURS = {
  fri: [['08:00', '17:00']],
  mon: [['08:00', '17:00']],
  sat: [['09:00', '13:00']],
  sun: [],
  thu: [['08:00', '17:00']],
  tue: [['08:00', '17:00']],
  wed: [['08:00', '17:00']],
};

beforeEach(async () => {
  await prisma.$executeRawUnsafe('TRUNCATE account, garage CASCADE');
});

afterAll(() => prisma.$disconnect());

async function garageOf(ownerName: string) {
  const owner = await account(ownerName, ['garage']);
  const garage = await prisma.garage.create({
    data: {
      hours: HOURS,
      name: `Service ${ownerName}`,
      slug: `service-${randomUUID()}`,
    },
  });
  await prisma.garageMember.create({
    data: { accountId: owner, garageId: garage.id, role: 'owner' },
  });
  return { garage: garage.id, owner };
}

type CardRow = {
  account_id: string | null;
  can_answer_quotes: boolean;
  can_move_bookings: boolean;
  can_record_final_price: boolean;
  certifications: string[];
  is_owner: boolean;
  name: string;
  on_profile: boolean;
  specialties: string[];
  working_hours: unknown;
};

const cardsOf = (garageId: string) =>
  prisma.$queryRaw<CardRow[]>`
    SELECT account_id, can_answer_quotes, can_move_bookings,
      can_record_final_price, certifications, is_owner, name, on_profile,
      specialties, working_hours
    FROM mechanic WHERE garage_id = ${garageId}::uuid ORDER BY name`;

// @traces 056-FR-001
describe('the mechanic card columns', () => {
  let card = '';

  beforeEach(async () => {
    const { garage } = await garageOf('Mihai Ionescu');
    card = (
      await prisma.mechanic.create({
        data: { garageId: garage, name: 'Elena' },
      })
    ).id;
  });

  const set = (column: string, value: unknown) =>
    prisma.$executeRawUnsafe(
      `UPDATE mechanic SET ${column} = $1 WHERE id = $2::uuid`,
      value,
      card,
    );

  it('gives a new card empty lists, no role, no years and not the owner', async () => {
    const [row] = await prisma.$queryRaw<
      {
        brand_ids: string[];
        certifications: string[];
        is_owner: boolean;
        role_title: string | null;
        specialties: string[];
        working_hours: unknown;
        years: number | null;
      }[]
    >`SELECT brand_ids, certifications, is_owner, role_title, specialties,
        working_hours, years
      FROM mechanic WHERE id = ${card}::uuid`;

    expect(row).toEqual({
      brand_ids: [],
      certifications: [],
      is_owner: false,
      role_title: null,
      specialties: [],
      working_hours: null,
      years: null,
    });
  });

  it('keeps a role title of 40 characters and refuses one of 41', async () => {
    await expect(set('role_title', 'Ș'.repeat(40))).resolves.toBe(1);
    await expect(set('role_title', 'Ș'.repeat(41))).rejects.toThrow(
      /mechanic_role_title_length/,
    );
  });

  it('keeps 0 and 60 years and refuses -1 and 61', async () => {
    await expect(set('years', 0)).resolves.toBe(1);
    await expect(set('years', 60)).resolves.toBe(1);
    await expect(set('years', -1)).rejects.toThrow(/mechanic_years_range/);
    await expect(set('years', 61)).rejects.toThrow(/mechanic_years_range/);
  });

  it('keeps six specialties and refuses seven', async () => {
    const six = ['a', 'b', 'c', 'd', 'e', 'f'];

    await expect(set('specialties', six)).resolves.toBe(1);
    await expect(set('specialties', [...six, 'g'])).rejects.toThrow(
      /mechanic_specialties_count/,
    );
  });

  it('keeps ten certifications and refuses eleven', async () => {
    const ten = Array.from({ length: 10 }, (_, i) => `C${i}`);

    await expect(set('certifications', ten)).resolves.toBe(1);
    await expect(set('certifications', [...ten, 'C10'])).rejects.toThrow(
      /mechanic_certifications_count/,
    );
  });

  it('keeps a speciality line of 250 characters and refuses one of 251', async () => {
    await expect(set('speciality', 'ș'.repeat(250))).resolves.toBe(1);
    await expect(set('speciality', 'ș'.repeat(251))).rejects.toThrow(
      /mechanic_speciality_length/,
    );
  });
});

// @traces 056-FR-001
describe("the migration's backfill of the owner's row", () => {
  it("marks the owner's existing card as the owner's, and no other card", async () => {
    const { garage, owner } = await garageOf('Mihai Ionescu');
    const mechanic = await account('Elena Stan', ['mechanic']);
    await prisma.mechanic.createMany({
      data: [
        { accountId: owner, garageId: garage, name: 'Mihai Ionescu' },
        { accountId: mechanic, garageId: garage, name: 'Elena Stan' },
        { garageId: garage, name: 'Costel' },
      ],
    });

    await runBackfill();

    expect(
      (await cardsOf(garage)).map((row) => [row.name, row.is_owner]),
    ).toEqual([
      ['Costel', false],
      ['Elena Stan', false],
      ['Mihai Ionescu', true],
    ]);
  });

  it('creates the owner a row for a garage that has none, with its hours, off the profile and with every right', async () => {
    const { garage, owner } = await garageOf('Mihai Ionescu');
    await prisma.mechanic.create({
      data: { garageId: garage, name: 'Costel' },
    });

    await runBackfill();

    const rows = await cardsOf(garage);
    expect(rows).toHaveLength(2);
    expect(rows.find((row) => row.is_owner)).toEqual({
      account_id: owner,
      can_answer_quotes: true,
      can_move_bookings: true,
      can_record_final_price: true,
      certifications: [],
      is_owner: true,
      name: 'Mihai Ionescu',
      on_profile: false,
      specialties: [],
      working_hours: HOURS,
    });
  });

  it('makes no row for an owner whose account already holds a card at another garage', async () => {
    const elsewhere = await garageOf('Ana Pop');
    const { garage, owner } = await garageOf('Mihai Ionescu');
    await prisma.mechanic.create({
      data: { accountId: owner, garageId: elsewhere.garage, name: 'Mihai' },
    });

    await runBackfill();

    expect(await cardsOf(garage)).toEqual([]);
    expect(await prisma.mechanic.count({ where: { accountId: owner } })).toBe(
      1,
    );
    expect(
      (await cardsOf(elsewhere.garage)).map((row) => [
        row.account_id,
        row.is_owner,
      ]),
    ).toEqual(
      expect.arrayContaining([
        [owner, false],
        [elsewhere.owner, true],
      ]),
    );
  });

  it('adds nothing when run a second time', async () => {
    const { garage } = await garageOf('Mihai Ionescu');

    await runBackfill();
    await runBackfill();

    expect(await cardsOf(garage)).toHaveLength(1);
  });
});

// @traces 059-FR-019
describe('the team-on-profile migration', () => {
  const SWITCHES = join(
    __dirname,
    '../../../prisma/migrations/20261031120000_team_on_profile/migration.sql',
  );

  it('adds both switches on, so nothing changes for a garage already listed', () => {
    const sql = readFileSync(SWITCHES, 'utf8');

    expect(sql).toMatch(
      /ALTER TABLE garage ADD COLUMN team_on_profile BOOLEAN NOT NULL DEFAULT true/,
    );
    expect(sql).toMatch(
      /ALTER TABLE mechanic ADD COLUMN takes_direct_requests BOOLEAN NOT NULL DEFAULT true/,
    );
  });

  it('reads an approved garage and its consented, joined card as shown and taking direct requests', async () => {
    const { garage } = await garageOf('Mihai');
    const mechanic = await account('Vlad', ['mechanic']);
    await prisma.$executeRaw`UPDATE garage SET status = 'approved' WHERE id = ${garage}::uuid`;
    await prisma.$executeRaw`
      INSERT INTO mechanic (id, garage_id, account_id, name, on_profile)
      VALUES (gen_random_uuid(), ${garage}::uuid, ${mechanic}::uuid, 'Tudor Vlad', true)`;

    expect(
      await prisma.garage.findUniqueOrThrow({
        select: { teamOnProfile: true },
        where: { id: garage },
      }),
    ).toEqual({ teamOnProfile: true });
    expect(
      await prisma.mechanic.findMany({
        select: { takesDirectRequests: true },
        where: { garageId: garage, ...shownOnProfile() },
      }),
    ).toEqual([{ takesDirectRequests: true }]);
  });
});
