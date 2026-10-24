// @traces 129-FR-007 129-FR-009 055-FR-004
import { leaveTeams } from './team-leave';
import { serialDatabase } from '../../auth/serial-db.testing';
import type { EventPort } from '../../events/event.port';
import { databaseUrl } from '../../notifications/notifications.testing';
import { quotesWorld } from '../../quotes/quotes.testing';
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

beforeEach(async () => {
  recorded = [];
  await world.reset();
});

afterAll(() => prisma.$disconnect());

const leave = (accountId: string) =>
  prisma.$transaction((tx) => leaveTeams(tx, events, accountId));

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
      {
        audience: { garageIds: [garage.id], type: 'garage' },
        kind: 'mechanic.updated',
        payload: {
          from: 'account_deleted',
          garageId: garage.id,
          mechanicId: mechanic.id,
        },
        subjectId: mechanic.id,
      },
    ]);
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
