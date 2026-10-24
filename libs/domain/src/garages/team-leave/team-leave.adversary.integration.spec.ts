import { leaveTeams } from './team-leave';
import { serialDatabase } from '../../auth/serial-db.testing';
import type { DomainEvent, EventPort } from '../../events/event.port';
import { databaseUrl } from '../../notifications/notifications.testing';
import { quotesWorld } from '../../quotes/quotes.testing';

const world = quotesWorld();
const { prisma } = world;
serialDatabase(databaseUrl);

let recorded: DomainEvent[];
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

const leave = (accountId: string, port: EventPort = events) =>
  prisma.$transaction((tx) => leaveTeams(tx, port, accountId));

// @traces 129-FR-009
describe('leaving the garage team, attacked', () => {
  it('leaves an owner membership alone: only receptionist rows go', async () => {
    const garage = await world.garage('Atelier Dinamo');
    const north = await world.garage('Service Nord');
    const accountId = await world.account('Mihai Pop', ['garage']);
    await prisma.garageMember.createMany({
      data: [
        { accountId, garageId: garage.id, role: 'owner' },
        { accountId, garageId: north.id, role: 'receptionist' },
      ],
    });

    await leave(accountId);

    expect(
      await prisma.garageMember.findMany({
        select: { garageId: true, role: true },
        where: { accountId },
      }),
    ).toEqual([{ garageId: garage.id, role: 'owner' }]);
    expect(recorded.map((e) => [e.kind, e.subjectId])).toEqual([
      ['member.removed', north.id],
    ]);
  });

  it('handles an account that is both a mechanic and a receptionist elsewhere', async () => {
    const home = await world.garage('Atelier Dinamo');
    const north = await world.garage('Service Nord');
    const accountId = await world.account('Elena Pop', ['mechanic']);
    const mechanic = await prisma.mechanic.create({
      data: { accountId, garageId: home.id, name: 'Elena', onProfile: true },
    });
    await prisma.garageMember.create({
      data: { accountId, garageId: north.id, role: 'receptionist' },
    });

    await leave(accountId);

    expect(
      await prisma.mechanic.findUniqueOrThrow({ where: { id: mechanic.id } }),
    ).toMatchObject({ accountId: null, onProfile: false });
    expect(recorded.map((e) => e.kind).sort()).toEqual([
      'mechanic.removed',
      'member.removed',
    ]);
  });

  it('keeps the future booking of the mechanic with its mechanic and status', async () => {
    const garage = await world.garage('Atelier Dinamo');
    const accountId = await world.account('Elena Pop', ['mechanic']);
    const mechanic = await prisma.mechanic.create({
      data: { accountId, garageId: garage.id, name: 'Elena', onProfile: true },
    });
    const before = await prisma.job.findMany({
      where: { mechanicId: mechanic.id },
    });

    await leave(accountId);

    expect(
      await prisma.job.findMany({ where: { mechanicId: mechanic.id } }),
    ).toEqual(before);
  });

  it("leaves another account's mechanic card untouched", async () => {
    const garage = await world.garage('Atelier Dinamo');
    const gone = await world.account('Elena Pop', ['mechanic']);
    const stays = await world.account('Ion Pop', ['mechanic']);
    await prisma.mechanic.createMany({
      data: [
        {
          accountId: gone,
          garageId: garage.id,
          name: 'Elena',
          onProfile: true,
        },
        { accountId: stays, garageId: garage.id, name: 'Ion', onProfile: true },
      ],
    });

    await leave(gone);

    expect(
      await prisma.mechanic.findUniqueOrThrow({ where: { accountId: stays } }),
    ).toMatchObject({ onProfile: true });
  });

  it('is a no-op the second time: nothing recorded, rows as they were', async () => {
    const garage = await world.garage('Atelier Dinamo');
    const accountId = await world.account('Elena Pop', ['mechanic']);
    await prisma.mechanic.create({
      data: { accountId, garageId: garage.id, name: 'Elena', onProfile: true },
    });
    await leave(accountId);
    recorded = [];

    await leave(accountId);

    expect(recorded).toEqual([]);
  });

  it('does nothing for an account id nobody holds', async () => {
    await leave('00000000-0000-4000-8000-000000000000');

    expect(recorded).toEqual([]);
  });

  it('rolls back the detach when recording the event fails', async () => {
    const garage = await world.garage('Atelier Dinamo');
    const accountId = await world.account('Elena Pop', ['mechanic']);
    const mechanic = await prisma.mechanic.create({
      data: { accountId, garageId: garage.id, name: 'Elena', onProfile: true },
    });

    await expect(
      leave(accountId, {
        record: async () => {
          throw new Error('outbox down');
        },
      }),
    ).rejects.toThrow('outbox down');

    expect(
      await prisma.mechanic.findUniqueOrThrow({ where: { id: mechanic.id } }),
    ).toMatchObject({ accountId, onProfile: true });
  });

  it('carries no personal value in its events', async () => {
    const garage = await world.garage('Atelier Dinamo');
    const accountId = await world.account('Elena Pop', ['mechanic']);
    await prisma.mechanic.create({
      data: { accountId, garageId: garage.id, name: 'Elena', onProfile: true },
    });

    await leave(accountId);

    expect(JSON.stringify(recorded)).not.toContain('Elena');
    expect(JSON.stringify(recorded)).not.toContain('Pop');
  });
});
