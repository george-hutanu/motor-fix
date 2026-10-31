import { randomUUID } from 'node:crypto';

import { SuspensionService } from './suspension.service';
import { staffedGarage } from './suspension.testing';
import { AuditService } from '../../../audit/audit.service';
import type { Actor } from '../../../auth/policy';
import { serialDatabase } from '../../../auth/serial-db.testing';
import { type EventPort, outbox } from '../../../events/event.port';
import {
  databaseUrl,
  fixtures,
} from '../../../notifications/notifications.testing';

// @traces 154-FR-014

const { account, prisma, reset } = fixtures();
serialDatabase(databaseUrl);

const REASON = 'Autorizație RAR expirată pe 12 sept. 2026';
const NOTE = 'A trimis autorizația reînnoită, verificată în registru.';
const NONE = {
  canAnswerQuotes: false,
  canMoveBookings: false,
  canRecordFinalPrice: false,
};

const service = (events: EventPort = outbox) =>
  new SuspensionService(prisma, new AuditService(), events);

const brand = (name: string) => {
  const key = `${name.toLowerCase()}-${randomUUID()}`;
  return prisma.brand.create({ data: { key, name: key, slug: key } });
};

const eventOf = (garageId: string, kind: string) =>
  prisma.outboxEvent.findFirstOrThrow({ where: { kind, subjectId: garageId } });

let admin: Actor;
let garage: Awaited<ReturnType<typeof staffedGarage>>;
let worksOn: string[];
let refused: string;

beforeEach(async () => {
  await reset();
  await prisma.$executeRawUnsafe('TRUNCATE outbox_event');
  garage = await staffedGarage(prisma, account);
  const [dacia, renault, tesla] = await Promise.all([
    brand('Dacia'),
    brand('Renault'),
    brand('Tesla'),
  ]);
  worksOn = [dacia.id, renault.id];
  refused = tesla.id;
  await prisma.garageBrand.createMany({
    data: [
      ...worksOn.map((brandId) => ({
        brandId,
        garageId: garage.id,
        stance: 'works_on' as const,
      })),
      { brandId: refused, garageId: garage.id, stance: 'does_not_take' },
    ],
  });
  const adminId = await account('Ioana Popa', ['admin']);
  admin = {
    accountId: adminId,
    garageId: null,
    permissions: NONE,
    role: 'admin',
    roles: ['admin'],
  };
});

afterAll(() => prisma.$disconnect());

describe('the search of each brand a garage takes', () => {
  it('hears the garage suspended', async () => {
    await service().suspend(admin, garage.id, 'admin', REASON);

    const { audience } = await eventOf(garage.id, 'garage.suspended');
    expect([...audience].sort()).toEqual(
      [
        'admin',
        `garage:${garage.id}`,
        `public:garage:${garage.id}`,
        'public:search',
        ...worksOn.map((id) => `public:search:${id}`),
      ].sort(),
    );
    expect(audience).not.toContain(`public:search:${refused}`);
  });

  it('hears the garage restored', async () => {
    await service().suspend(admin, garage.id, 'admin', REASON);
    await prisma.$executeRawUnsafe('TRUNCATE outbox_event');

    await service().restore(admin, garage.id, { note: NOTE });

    const { audience } = await eventOf(garage.id, 'garage.restored');
    expect([...audience].sort()).toEqual(
      [
        'admin',
        `garage:${garage.id}`,
        `public:garage:${garage.id}`,
        'public:search',
        ...worksOn.map((id) => `public:search:${id}`),
      ].sort(),
    );
    expect(audience).not.toContain(`public:search:${refused}`);
  });

  it('leaves no event when the suspension rolls back', async () => {
    const failing: EventPort = {
      record: async (tx, event) => {
        await outbox.record(tx, event);
        if (event.kind === 'garage.suspended') throw new Error('relay down');
      },
    };

    await expect(
      service(failing).suspend(admin, garage.id, 'admin', REASON),
    ).rejects.toThrow('relay down');

    expect(
      await prisma.outboxEvent.count({ where: { subjectId: garage.id } }),
    ).toBe(0);
    expect(
      (await prisma.garage.findUniqueOrThrow({ where: { id: garage.id } }))
        .status,
    ).toBe('approved');
  });
});
