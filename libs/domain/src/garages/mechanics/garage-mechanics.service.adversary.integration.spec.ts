import { randomUUID } from 'node:crypto';

import type { MechanicsSection } from '@motor-fix/contracts';

import { GarageMechanicsService } from './garage-mechanics.service';
import { AuditService } from '../../audit/audit.service';
import { serialDatabase } from '../../auth/serial-db.testing';
import {
  databaseUrl,
  fixtures,
} from '../../notifications/notifications.testing';
import { refused } from '../prices/garage-prices.testing';

const { account, prisma } = fixtures();
const mechanics = new GarageMechanicsService(new AuditService());
serialDatabase(databaseUrl);

let owner = '';
let garage = '';
let other = '';

beforeEach(async () => {
  await prisma.$executeRawUnsafe('TRUNCATE account, garage CASCADE');
  owner = await account('Mihai Ionescu', ['garage']);
  garage = (
    await prisma.garage.create({
      data: { name: 'Service Auto Nord', slug: `nord-${randomUUID()}` },
    })
  ).id;
  other = (
    await prisma.garage.create({
      data: { name: 'Service Sud', slug: `sud-${randomUUID()}` },
    })
  ).id;
});

afterAll(async () => {
  await prisma.$disconnect();
});

const save = (section: MechanicsSection, into = garage) =>
  prisma.$transaction((tx) => mechanics.saveCards(tx, into, owner, section));

const cards = (of = garage) =>
  prisma.mechanic.findMany({ where: { garageId: of } });

const names = (count: number) =>
  Array.from({ length: count }, (_, i) => ({ name: `Mecanic ${i}` }));

describe('GarageMechanicsService.saveCards under hostile input', () => {
  it('takes a name of exactly 60 and a speciality of exactly 80', async () => {
    await save({
      mechanics: [{ name: 'n'.repeat(60), speciality: 's'.repeat(80) }],
    });

    expect(await cards()).toHaveLength(1);
  });

  it('takes a name of 60 characters padded with spaces', async () => {
    await save({ mechanics: [{ name: `  ${'n'.repeat(60)}  ` }] });

    expect((await cards())[0].name).toBe('n'.repeat(60));
  });

  it('refuses a name of 61 and a speciality of 81, naming the row', async () => {
    expect(
      await refused(
        save({
          mechanics: [
            { name: 'Ion' },
            { name: 'n'.repeat(61), speciality: 's'.repeat(81) },
          ],
        }),
      ),
    ).toEqual(
      expect.arrayContaining([
        { code: 'length', field: 'mechanics[1].name' },
        { code: 'length', field: 'mechanics[1].speciality' },
      ]),
    );
    expect(await cards()).toEqual([]);
  });

  it.each(['', ' ', 'a', ' a ', '\t\n', '  '])(
    'refuses a name of %j as too short and writes none of the other cards',
    async (name) => {
      expect(
        await refused(save({ mechanics: [{ name: 'Ion Marin' }, { name }] })),
      ).toEqual([{ code: 'length', field: 'mechanics[1].name' }]);
      expect(await cards()).toEqual([]);
    },
  );

  it('refuses thirty-one cards even when they are all good, and none is written', async () => {
    expect(await refused(save({ mechanics: names(31) }))).toEqual([
      { code: 'too_many', field: 'mechanics' },
    ]);
    expect(await cards()).toEqual([]);
  });

  it('refuses ten thousand cards with one too_many, not ten thousand errors', async () => {
    const errors = await refused(save({ mechanics: names(10_000) }));

    expect(errors).toEqual([{ code: 'too_many', field: 'mechanics' }]);
  });

  it('refuses a null speciality as a field error or stores it as empty, never a server error', async () => {
    await save({
      mechanics: [{ name: 'Ion', speciality: null } as never],
    });

    expect((await cards())[0].speciality).toBeNull();
  });

  it('refuses a name that is not a string with a field error', async () => {
    const errors = await refused(save({ mechanics: [{ name: 42 } as never] }));

    expect(errors.map((e) => e.field)).toEqual(['mechanics[0].name']);
  });

  it('keeps two mechanics of one name as two cards', async () => {
    await save({ mechanics: [{ name: 'Ion Marin' }, { name: 'Ion Marin' }] });

    expect(await cards()).toHaveLength(2);
  });

  it('keeps unicode names and specialities intact', async () => {
    await save({
      mechanics: [{ name: 'Ștefan Țăranu', speciality: 'Cutii de viteze 🔧' }],
    });

    expect(await cards()).toEqual([
      expect.objectContaining({
        name: 'Ștefan Țăranu',
        speciality: 'Cutii de viteze 🔧',
      }),
    ]);
  });

  it('writes the cards to the garage it was given and to no other', async () => {
    await save({ mechanics: [{ name: 'Ion' }] }, other);

    expect(await cards()).toEqual([]);
    expect(await cards(other)).toHaveLength(1);
  });

  it('ignores an account id or on-profile value slipped into a card', async () => {
    const accountId = await account('Ana Pop', ['mechanic']);

    await save({
      mechanics: [{ accountId, name: 'Ion', onProfile: true } as never],
    });

    expect(await cards()).toEqual([
      expect.objectContaining({ accountId: null, onProfile: false }),
    ]);
  });

  it('adds the cards again when the same section is saved twice, one audit entry each time', async () => {
    const section = { mechanics: [{ name: 'Ion' }] };

    const first = await save(section);
    const second = await save(section);

    expect(new Set([...first.ids, ...second.ids]).size).toBe(2);
    const entries = await prisma.activityLog.count({
      where: { garageId: garage, subjectType: 'mechanic' },
    });
    expect(entries).toBe(2);
  });

  it('fails for a garage that does not exist without leaving a card or an entry', async () => {
    const missing = randomUUID();
    await expect(
      save({ mechanics: [{ name: 'Ion' }] }, missing),
    ).rejects.toBeDefined();

    expect(await prisma.mechanic.count()).toBe(0);
    expect(
      await prisma.activityLog.count({
        where: { garageId: missing, subjectType: 'mechanic' },
      }),
    ).toBe(0);
  });

  it('writes nothing when the section is refused after a good one in one transaction', async () => {
    await expect(
      prisma.$transaction(async (tx) => {
        await mechanics.saveCards(tx, garage, owner, { mechanics: names(2) });
        await mechanics.saveCards(tx, garage, owner, { mechanics: names(31) });
      }),
    ).rejects.toMatchObject({ status: 422 });

    expect(await cards()).toEqual([]);
  });
});
