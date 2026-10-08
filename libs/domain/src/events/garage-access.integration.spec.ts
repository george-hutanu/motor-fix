import { randomUUID } from 'node:crypto';

import { loadGarageAccess } from './garage-access';
import { serialDatabase } from '../auth/serial-db.testing';
import { databaseUrl, fixtures } from '../notifications/notifications.testing';

const { account, prisma } = fixtures();
serialDatabase(databaseUrl);

beforeEach(async () => {
  await prisma.$executeRawUnsafe('TRUNCATE account, garage CASCADE');
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('who may hear a garage', () => {
  it('leaves out a mechanic card with no account yet, and keeps the invited mechanic', async () => {
    const mihai = await account('Mihai', ['mechanic']);
    const { id: garageId } = await prisma.garage.create({
      data: { name: 'Service Auto Nord', slug: `nord-${randomUUID()}` },
    });
    await prisma.mechanic.create({
      data: {
        accountId: mihai,
        canAnswerQuotes: true,
        garageId,
        name: 'Mihai',
      },
    });
    await prisma.mechanic.create({ data: { garageId, name: 'Ion Marin' } });

    const access = await loadGarageAccess(prisma)(garageId);

    expect([...access.mechanics.keys()]).toEqual([mihai]);
    expect(access.mechanics.get(mihai)).toMatchObject({
      canAnswerQuotes: true,
    });
  });
});
