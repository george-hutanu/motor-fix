// @traces 129-FR-007 129-FR-009 055-FR-004
// @traces 056-FR-014
// @traces 427-FR-012
import { leaveTeams } from './team-leave';
import type { AuditEntry, AuditPort } from '../../audit/audit.port';
import { serialDatabase } from '../../auth/serial-db.testing';
import { localDay } from '../../bucharest';
import { audienceOf, type LiveSubject } from '../../events/audience';
import type { EventPort } from '../../events/event.port';
import { databaseUrl } from '../../notifications/notifications.testing';
import { quotesWorld } from '../../quotes/quotes.testing';
import * as reads from '../../quotes/reads';
import { mechanicReviews } from '../../reviews/reviews.testing';

const world = quotesWorld();
const { prisma } = world;
const { reviewed } = mechanicReviews(world);
serialDatabase(databaseUrl);

let recorded: unknown[];
const events: EventPort = {
  record: async (_tx, event) => {
    recorded.push(event);
  },
};

let audited: AuditEntry[];
const audit: AuditPort = {
  record: async (_tx, entry) => {
    audited.push(entry);
  },
  recordChanges: async () => undefined,
  recordMany: async (_tx, entries) => {
    audited.push(...entries);
  },
};

beforeEach(async () => {
  audited = [];
  recorded = [];
  await world.reset();
});

afterAll(() => prisma.$disconnect());

const leave = (accountId: string) =>
  prisma.$transaction((tx) => leaveTeams(tx, { audit, events }, accountId));

describe('leaving the garage team when the account is deleted', () => {
  it('detaches the mechanic and takes him off the profile, keeping his name, rating, reviews and jobs', async () => {
    const garage = await world.garage('Atelier Dinamo');
    const accountId = await world.account('Elena Pop', ['mechanic']);
    const mechanic = await prisma.mechanic.create({
      data: {
        accountId,
        garageId: garage.id,
        name: 'Elena',
        onProfile: true,
        rating: 4.5,
        reviewCount: 1,
      },
    });
    const driver = await world.account('Andrei Ion Marin', ['driver']);
    const review = await reviewed(driver, garage.id, mechanic.id, 1);

    await leave(accountId);

    expect(
      await prisma.mechanic.findUniqueOrThrow({ where: { id: mechanic.id } }),
    ).toMatchObject({
      accountId: null,
      name: 'Elena',
      onProfile: false,
      reviewCount: 1,
    });
    expect(
      Number(
        (
          await prisma.mechanic.findUniqueOrThrow({
            where: { id: mechanic.id },
          })
        ).rating,
      ),
    ).toBe(4.5);
    expect(
      await prisma.review.findUniqueOrThrow({ where: { id: review.id } }),
    ).toMatchObject({ mechanicId: mechanic.id });
    expect(await prisma.job.count({ where: { mechanicId: mechanic.id } })).toBe(
      1,
    );
    expect(recorded).toEqual([
      expect.objectContaining({
        kind: 'mechanic.removed',
        payload: {
          from: 'account_deleted',
          garageId: garage.id,
          mechanicId: mechanic.id,
        },
        subjectId: mechanic.id,
      }),
    ]);
    const [{ audience }] = recorded as { audience: LiveSubject }[];
    expect(audienceOf(audience)).toEqual(
      expect.arrayContaining([
        `garage:${garage.id}`,
        `public:garage:${garage.id}`,
        `public:mechanic:${mechanic.id}`,
      ]),
    );
  });

  // @traces 059-FR-011
  it('keeps the removal off the public channels while the garage hides its team', async () => {
    const garage = await world.garage('Atelier Dinamo');
    await prisma.garage.update({
      data: { teamOnProfile: false },
      where: { id: garage.id },
    });
    const accountId = await world.account('Elena Pop', ['mechanic']);
    const mechanic = await prisma.mechanic.create({
      data: { accountId, garageId: garage.id, name: 'Elena', onProfile: true },
    });

    await leave(accountId);

    const [{ audience }] = recorded as { audience: LiveSubject }[];
    expect(audienceOf(audience)).toEqual([
      `garage:${garage.id}`,
      `mechanic:${mechanic.id}`,
    ]);
  });

  it("leaves the card's future confirmed booking to reassign, and a past one not", async () => {
    const garage = await world.garage('Atelier Dinamo');
    const accountId = await world.account('Elena Pop', ['mechanic']);
    const mechanic = await prisma.mechanic.create({
      data: { accountId, garageId: garage.id, name: 'Elena', onProfile: true },
    });
    const ahead = await world.booked(
      garage.id,
      new Date(Date.now() + 48 * 3_600_000).toISOString(),
      'confirmed',
      { mechanicId: mechanic.id },
    );
    const past = await world.booked(
      garage.id,
      new Date(Date.now() - 48 * 3_600_000).toISOString(),
      'confirmed',
      { mechanicId: mechanic.id },
    );

    await leave(accountId);

    const read = async (id: string) =>
      reads.garageBookingOf(
        await prisma.booking.findUniqueOrThrow({
          include: reads.bookingMechanicInclude(localDay(new Date())),
          where: { id },
        }),
      ) as unknown as { toReassign?: boolean };
    expect((await read(ahead.id)).toReassign).toBe(true);
    expect((await read(past.id)).toReassign).toBe(false);
    expect(
      await prisma.mechanic.count({
        where: { garageId: garage.id, removedAt: null },
      }),
    ).toBe(0);
  });

  it('marks the detached card removed, so a new account of the same person gets a card of its own', async () => {
    const garage = await world.garage('Atelier Dinamo');
    const accountId = await world.account('Elena Pop', ['mechanic']);
    const mechanic = await prisma.mechanic.create({
      data: { accountId, garageId: garage.id, name: 'Elena', onProfile: true },
    });

    await leave(accountId);

    const detached = await prisma.mechanic.findUniqueOrThrow({
      where: { id: mechanic.id },
    });
    expect(detached.removedAt).toBeInstanceOf(Date);
    const again = await world.account('Elena Pop din nou', ['mechanic']);
    await prisma.mechanic.create({
      data: { accountId: again, garageId: garage.id, name: 'Elena' },
    });
    expect(
      await prisma.mechanic.count({
        where: { garageId: garage.id, removedAt: null },
      }),
    ).toBe(1);
    expect(
      await prisma.mechanic.findUniqueOrThrow({ where: { id: mechanic.id } }),
    ).toMatchObject({ accountId: null, removedAt: detached.removedAt });
  });

  it('deletes the receptionist membership and tells the garage', async () => {
    const garage = await world.garage('Atelier Dinamo');
    const other = await world.garage('Service Nord');
    const accountId = await world.account('Ioana Pop', ['receptionist']);
    const colleague = await world.account('Mihai Pop', ['receptionist']);
    await prisma.garageMember.createMany({
      data: [
        { accountId, garageId: garage.id, role: 'receptionist' },
        { accountId: colleague, garageId: other.id, role: 'receptionist' },
      ],
    });

    await leave(accountId);

    expect(
      await prisma.garageMember.findMany({ select: { accountId: true } }),
    ).toEqual([{ accountId: colleague }]);
    expect(recorded).toEqual([
      {
        audience: { garageIds: [garage.id], type: 'garage' },
        kind: 'member.removed',
        payload: { accountId, garageId: garage.id },
        subjectId: garage.id,
      },
    ]);
  });

  it('changes nothing and records nothing for a driver with no team', async () => {
    const accountId = await world.account('Andrei Ion Marin', ['driver']);

    await leave(accountId);

    expect(recorded).toEqual([]);
  });
});

describe("the deleted mechanic's blocked time", () => {
  const HOUR = 3_600_000;
  const at = (hours: number) =>
    new Date(
      Math.round((Date.now() + hours * HOUR) / (15 * 60_000)) * 15 * 60_000,
    );

  async function blocked(
    garageId: string,
    createdBy: string,
    mechanicId: string,
    from: Date,
    to: Date,
  ) {
    const block = await prisma.timeBlock.create({
      data: {
        createdBy,
        endsAt: to,
        garageId,
        mechanicId,
        note: 'Concediu',
        startsAt: from,
        updatedBy: createdBy,
      },
    });
    await prisma.bookingSegment.create({
      data: {
        endsAt: to,
        garageId,
        mechanicId,
        startsAt: from,
        timeBlockId: block.id,
      },
    });
    return block;
  }

  it('takes her blocks still to come with her, each recorded as the system removing it, and keeps the past one', async () => {
    const garage = await world.garage('Atelier Dinamo');
    const owner = await world.account('Mihai Pop', ['garage']);
    const accountId = await world.account('Elena Pop', ['mechanic']);
    const mechanic = await prisma.mechanic.create({
      data: { accountId, garageId: garage.id, name: 'Elena' },
    });
    const soon = await blocked(garage.id, owner, mechanic.id, at(24), at(26));
    const now = await blocked(garage.id, owner, mechanic.id, at(-1), at(2));
    const past = await blocked(garage.id, owner, mechanic.id, at(-50), at(-48));

    await leave(accountId);

    const left = await prisma.timeBlock.findMany({
      where: { garageId: garage.id },
    });
    expect(left).toEqual([
      expect.objectContaining({ id: past.id, mechanicId: mechanic.id }),
    ]);
    expect(
      await prisma.bookingSegment.count({
        where: { timeBlockId: { in: [soon.id, now.id] } },
      }),
    ).toBe(0);
    expect(
      await prisma.bookingSegment.count({ where: { timeBlockId: past.id } }),
    ).toBe(1);
    expect(audited).toHaveLength(2);
    for (const entry of audited) {
      expect(entry).toMatchObject({
        action: 'delete',
        actorId: accountId,
        actorRole: 'system',
        garageId: garage.id,
        internal: true,
        oldValue: expect.objectContaining({
          mechanicId: mechanic.id,
          mechanicName: 'Elena',
          note: 'Concediu',
        }),
        subjectType: 'time_block',
      });
    }
    expect(audited.map((entry) => entry.subjectId).sort()).toEqual(
      [soon.id, now.id].sort(),
    );
    const deleted = (recorded as { kind: string; subjectId: string }[]).filter(
      (event) => event.kind === 'time_block.deleted',
    );
    expect(deleted.map((event) => event.subjectId).sort()).toEqual(
      [soon.id, now.id].sort(),
    );
  });
});
