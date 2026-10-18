import { randomUUID } from 'node:crypto';

import { publicGarages, publicGaragesSql } from './public-garages';
import { serialDatabase } from '../../auth/serial-db.testing';
import {
  databaseUrl,
  fixtures,
} from '../../notifications/notifications.testing';

const { prisma, reset } = fixtures();
serialDatabase(databaseUrl);

beforeEach(() => reset());

afterAll(() => prisma.$disconnect());

// @traces 1183-FR-004
describe('the public scope in its two forms', () => {
  it('lists the same garages whichever form a read uses', async () => {
    const garages = await Promise.all(
      (['draft', 'approved', 'suspended'] as const).map((status) =>
        prisma.garage.create({
          data: { name: status, slug: `${status}-${randomUUID()}`, status },
        }),
      ),
    );
    const ids = garages.map((garage) => garage.id);

    const built = await prisma.garage.findMany({
      select: { id: true },
      where: { id: { in: ids }, ...publicGarages() },
    });
    const raw = await prisma.$queryRaw<{ id: string }[]>`
      SELECT g.id FROM garage g
      WHERE g.id = ANY(${ids}::uuid[]) AND ${publicGaragesSql('g')}`;

    expect(raw.map((row) => row.id).sort()).toEqual(
      built.map((row) => row.id).sort(),
    );
    expect(raw.map((row) => row.id)).toEqual([garages[1].id]);
  });

  it('scopes a read under the table’s own name by default', async () => {
    const garage = await prisma.garage.create({
      data: {
        name: 'Listed',
        slug: `listed-${randomUUID()}`,
        status: 'approved',
      },
    });

    const raw = await prisma.$queryRaw<{ id: string }[]>`
      SELECT id FROM garage WHERE id = ${garage.id}::uuid AND ${publicGaragesSql()}`;

    expect(raw).toEqual([{ id: garage.id }]);
  });
});
