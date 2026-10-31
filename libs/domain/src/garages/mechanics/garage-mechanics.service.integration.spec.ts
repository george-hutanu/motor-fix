import { randomUUID } from 'node:crypto';

import type { FieldProblem, MechanicsSection } from '@motor-fix/contracts';

import { GarageMechanicsService } from './garage-mechanics.service';
import { AuditService } from '../../audit/audit.service';
import { serialDatabase } from '../../auth/serial-db.testing';
import {
  databaseUrl,
  fixtures,
} from '../../notifications/notifications.testing';
import { refused } from '../prices/garage-prices/garage-prices.testing';

const { account, prisma } = fixtures();
const mechanics = new GarageMechanicsService(
  new AuditService(),
  {} as never,
  {} as never,
);
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
  // @traces 059-FR-003
  it('creates one card per row, without an account, each off the profile until its mechanic agrees', async () => {
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
        onProfile: false,
        speciality: null,
      }),
      expect.objectContaining({
        accountId: null,
        name: 'Ion Marin',
        onProfile: false,
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

// @traces 208-FR-007
describe('GarageMechanicsService.saveAgain', () => {
  const again = (section: MechanicsSection) =>
    prisma.$transaction((tx) =>
      mechanics.saveAgain(tx, garage, owner, section),
    );
  // The first save's entries, left out: a millisecond stamp cannot part them.
  let earlier = new Set<string>();
  const newer = async () =>
    (await history()).filter((entry) => !earlier.has(entry.id));

  beforeEach(async () => {
    await save({
      mechanics: [
        { name: 'Andrei Pop', speciality: 'Electrică' },
        { name: 'Mihai Ionescu' },
      ],
      onProfile: true,
    });
    earlier = new Set((await history()).map((entry) => entry.id));
  });

  it('writes nothing for the same cards', async () => {
    const before = await cards();

    await again({
      mechanics: [
        { name: ' Andrei Pop ', speciality: 'Electrică' },
        { name: 'Mihai Ionescu' },
      ],
      onProfile: true,
    });

    expect(await cards()).toEqual(before);
    expect(await newer()).toEqual([]);
  });

  it('matches the cards by name: one added, one removed, one changed', async () => {
    const [andrei, mihai] = await cards();

    await again({
      mechanics: [
        { name: 'Andrei Pop', speciality: 'Diagnoză' },
        { name: 'Ion Marin' },
      ],
      onProfile: true,
    });

    const now = await cards();
    expect(now.map((card) => card.name)).toEqual(['Andrei Pop', 'Ion Marin']);
    expect(now[0]?.id).toBe(andrei?.id);
    expect(
      (await newer()).map(({ action, field, subjectId }) => ({
        action,
        field,
        subjectId,
      })),
    ).toEqual(
      expect.arrayContaining([
        { action: 'update', field: 'speciality', subjectId: andrei?.id },
        { action: 'delete', field: null, subjectId: mihai?.id },
        { action: 'create', field: null, subjectId: now[1]?.id },
      ]),
    );
    expect(await newer()).toHaveLength(3);
  });

  it('keeps a card that holds an account even when the section leaves it out', async () => {
    const [, mihai] = await cards();
    const accountId = await account('Mecanic Mihai', ['mechanic']);
    await prisma.mechanic.update({
      data: { accountId },
      where: { id: mihai?.id },
    });

    await again({
      mechanics: [{ name: 'Andrei Pop', speciality: 'Electrică' }],
      onProfile: true,
    });

    expect((await cards()).map((card) => card.name)).toEqual([
      'Andrei Pop',
      'Mihai Ionescu',
    ]);
    expect(await newer()).toEqual([]);
  });

  // @traces 055-FR-004
  it('leaves a removed card as it is and adds a new card of its name', async () => {
    const [, mihai] = await cards();
    await prisma.mechanic.update({
      data: { onProfile: false, removedAt: new Date() },
      where: { id: mihai?.id },
    });

    await again({
      mechanics: [
        { name: 'Andrei Pop', speciality: 'Electrică' },
        { name: 'Mihai Ionescu' },
      ],
      onProfile: true,
    });
    const kept = await prisma.mechanic.findUniqueOrThrow({
      where: { id: mihai?.id },
    });
    const fresh = (await cards()).filter(
      (card) => card.name === 'Mihai Ionescu' && card.id !== mihai?.id,
    );
    await again({
      mechanics: [{ name: 'Andrei Pop', speciality: 'Electrică' }],
      onProfile: true,
    });

    expect([kept.onProfile, kept.removedAt]).toEqual([false, expect.any(Date)]);
    expect(fresh).toEqual([
      expect.objectContaining({ onProfile: false, removedAt: null }),
    ]);
    expect((await cards()).map((card) => card.id)).toEqual(
      expect.arrayContaining([mihai?.id]),
    );
  });

  it('refuses a broken card and changes nothing', async () => {
    const before = await cards();

    expect(await refused(again({ mechanics: [{ name: 'A' }] }))).toEqual([
      { code: 'length', field: 'mechanics[0].name' },
    ]);
    expect(await cards()).toEqual(before);
  });
});

// @traces 059-FR-003
describe("step 4's switch on the garage", () => {
  let recorded: { kind: string; payload: unknown }[] = [];
  const announced = new GarageMechanicsService(
    new AuditService(),
    {
      record: async (
        _tx: unknown,
        event: { kind: string; payload: unknown },
      ) => {
        recorded.push(event);
      },
    } as never,
    {} as never,
  );
  const first = (section: MechanicsSection) =>
    prisma.$transaction((tx) =>
      announced.saveCards(tx, garage, owner, section),
    );
  const later = (section: MechanicsSection) =>
    prisma.$transaction((tx) =>
      announced.saveAgain(tx, garage, owner, section),
    );
  const teamOnProfile = async () =>
    (
      await prisma.garage.findUniqueOrThrow({
        select: { teamOnProfile: true },
        where: { id: garage },
      })
    ).teamOnProfile;
  const switchEntries = () =>
    prisma.activityLog.findMany({
      orderBy: { at: 'asc' },
      where: {
        at: { gte: since },
        field: 'team_on_profile',
        subjectType: 'garage',
      },
    });

  beforeEach(() => {
    recorded = [];
  });

  it('writes the switch off at creation, with one history entry and no event', async () => {
    await first({ mechanics: [{ name: 'Ion Marin' }], onProfile: false });

    expect(await teamOnProfile()).toBe(false);
    expect(
      (await switchEntries()).map((e) => [e.subjectId, e.oldValue, e.newValue]),
    ).toEqual([[garage, true, false]]);
    expect(recorded).toEqual([]);
    expect((await cards()).map((card) => card.onProfile)).toEqual([false]);
  });

  it('keeps the default when the section leaves the switch out', async () => {
    await first({ mechanics: [{ name: 'Ion Marin' }] });

    expect(await teamOnProfile()).toBe(true);
    expect(await switchEntries()).toEqual([]);
  });

  it("writes a later change to the garage, with its history entry and garage.updated, leaving each mechanic's consent alone", async () => {
    await first({ mechanics: [{ name: 'Ion Marin' }], onProfile: true });
    const [ion] = await cards();
    const accountId = await account('Ion Marin', ['mechanic']);
    await prisma.mechanic.update({
      data: { accountId, onProfile: true },
      where: { id: ion?.id },
    });

    await later({ mechanics: [{ name: 'Ion Marin' }], onProfile: false });

    expect(await teamOnProfile()).toBe(false);
    expect(
      (await switchEntries()).map((e) => [e.oldValue, e.newValue]),
    ).toEqual([[true, false]]);
    expect(recorded).toEqual([
      expect.objectContaining({
        kind: 'garage.updated',
        payload: { fields: ['team_on_profile'], garageId: garage },
      }),
    ]);
    expect((await cards())[0]).toMatchObject({ accountId, onProfile: true });
  });

  it('writes nothing for a later save that keeps the switch', async () => {
    await first({ mechanics: [{ name: 'Ion Marin' }], onProfile: true });

    await later({ mechanics: [{ name: 'Ion Marin' }], onProfile: true });

    expect(await switchEntries()).toEqual([]);
    expect(recorded).toEqual([]);
  });
});
