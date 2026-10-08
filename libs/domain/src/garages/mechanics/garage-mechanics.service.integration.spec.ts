import { randomUUID } from 'node:crypto';

import type { FieldProblem, MechanicsSection } from '@motor-fix/contracts';

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
let since = new Date(0);

beforeEach(async () => {
  await prisma.$executeRawUnsafe('TRUNCATE account, garage CASCADE');
  const [{ now }] = await prisma.$queryRaw<
    { now: Date }[]
  >`SELECT clock_timestamp() AS now`;
  since = now;
  owner = await account('Mihai Ionescu', ['garage']);
  garage = (
    await prisma.garage.create({
      data: { name: 'Service Auto Nord', slug: `nord-${randomUUID()}` },
    })
  ).id;
});

afterAll(async () => {
  await prisma.$disconnect();
});

const save = (section: MechanicsSection) =>
  prisma.$transaction((tx) => mechanics.saveCards(tx, garage, owner, section));

const cards = () =>
  prisma.mechanic.findMany({
    orderBy: { name: 'asc' },
    where: { garageId: garage },
  });

const history = () =>
  prisma.activityLog.findMany({
    orderBy: { at: 'asc' },
    where: { at: { gte: since }, subjectType: 'mechanic' },
  });

async function nothingStored() {
  expect(await cards()).toEqual([]);
  expect(await history()).toEqual([]);
}

const rows = (count: number) =>
  Array.from({ length: count }, (_, i) => ({ name: `Mecanic ${i}` }));

describe('GarageMechanicsService.saveCards', () => {
  it('creates one card per row, without an account, the switch on each', async () => {
    const { ids } = await save({
      mechanics: [
        { name: '  Ion Marin ', speciality: ' Diagnoză ' },
        { name: 'Ana Pop', speciality: '   ' },
      ],
      onProfile: true,
    });

    expect(await cards()).toEqual([
      expect.objectContaining({
        accountId: null,
        name: 'Ana Pop',
        onProfile: true,
        speciality: null,
      }),
      expect.objectContaining({
        accountId: null,
        name: 'Ion Marin',
        onProfile: true,
        speciality: 'Diagnoză',
      }),
    ]);
    expect(ids).toHaveLength(2);
  });

  it('keeps the cards off the profile when the switch is off or absent', async () => {
    await save({ mechanics: [{ name: 'Ion Marin' }] });

    expect(await cards()).toEqual([
      expect.objectContaining({ onProfile: false }),
    ]);
  });

  it('accepts no mechanics at all and writes nothing', async () => {
    expect(await save({ mechanics: [], onProfile: true })).toEqual({ ids: [] });
    expect(await save({})).toEqual({ ids: [] });
    await nothingStored();
  });

  it('records one create entry per card as the owner, and no event', async () => {
    const outboxBefore = await prisma.outboxEvent.count();

    const { ids } = await save({
      mechanics: [
        { name: 'Ion Marin', speciality: 'Diagnoză' },
        { name: 'Ana' },
      ],
    });

    expect(await history()).toEqual(
      ids.map((id) =>
        expect.objectContaining({
          action: 'create',
          actorId: owner,
          garageId: garage,
          subjectId: id,
        }),
      ),
    );
    expect(await prisma.outboxEvent.count()).toBe(outboxBefore);
  });

  it('takes thirty mechanics', async () => {
    await save({ mechanics: rows(30) });

    expect(await cards()).toHaveLength(30);
  });

  it.each<[string, MechanicsSection, FieldProblem[]]>([
    [
      'thirty-one mechanics',
      { mechanics: rows(31) },
      [{ code: 'too_many', field: 'mechanics' }],
    ],
    [
      'a one-letter name',
      { mechanics: [{ name: 'Ion' }, { name: ' I ' }] },
      [{ code: 'length', field: 'mechanics[1].name' }],
    ],
    [
      'a name over 60 characters',
      { mechanics: [{ name: 'x'.repeat(61) }] },
      [{ code: 'length', field: 'mechanics[0].name' }],
    ],
    [
      'a speciality over 80 characters',
      { mechanics: [{ name: 'Ion', speciality: 'x'.repeat(81) }] },
      [{ code: 'length', field: 'mechanics[0].speciality' }],
    ],
  ])('refuses %s and stores nothing', async (_, section, expected) => {
    expect(await refused(save(section))).toEqual(expected);
    await nothingStored();
  });

  it('leaves no card behind when the caller fails after the write', async () => {
    await expect(
      prisma.$transaction(async (tx) => {
        await mechanics.saveCards(tx, garage, owner, {
          mechanics: [{ name: 'Ion Marin' }],
        });
        throw new Error('the listing could not be sent');
      }),
    ).rejects.toThrow('the listing could not be sent');

    await nothingStored();
  });
});
