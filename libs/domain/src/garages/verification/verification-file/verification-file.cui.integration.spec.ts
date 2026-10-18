import { randomUUID } from 'node:crypto';

import { VerificationFileService } from './verification-file.service';
import { serialDatabase } from '../../../auth/serial-db.testing';
import type { CacheService } from '../../../cache/cache.service';
import {
  databaseUrl,
  fixtures,
} from '../../../notifications/notifications.testing';
import type { StorageService } from '../../../storage/storage.service';
import { PublicGaragesService } from '../../public-garages/public-garages';

// @traces 303-FR-007 303-FR-012

const { prisma, reset } = fixtures();
serialDatabase(databaseUrl);

const storage = {
  createDownloadUrl: async (key: string) => `https://store.test/${key}`,
  derivedKey: (key: string, copy: string) => `${key}.${copy}`,
  metadataOf: async () => null,
  ready: async () => undefined,
};

const service = () =>
  new VerificationFileService(
    prisma,
    storage as unknown as StorageService,
    new PublicGaragesService(
      prisma,
      {} as CacheService,
      storage as unknown as StorageService,
    ),
  );

const garage = (
  name: string,
  cui: string | null,
  status: 'draft' | 'approved' | 'suspended' = 'draft',
) =>
  prisma.garage.create({
    data: { cui, name, slug: `g-${randomUUID()}`, status },
  });

const usedBy = async (garageId: string) => {
  const file = await prisma.verificationFile.create({
    data: { garageId, status: 'submitted' },
  });
  return (await service().read(file.id)).garage.cuiAlsoUsedBy;
};

beforeEach(() => reset());

afterAll(() => prisma.$disconnect());

describe('the garages sharing a CUI', () => {
  it('are none when no other garage holds the CUI', async () => {
    const own = await garage('Atelier Dinamo', '18547290');
    await garage('Service Dobre', '12345678');

    expect(await usedBy(own.id)).toEqual([]);
  });

  it('are none when the CUI is not known, whoever else has none', async () => {
    const own = await garage('Atelier Dinamo', null);
    await garage('Service Dobre', null);

    expect(await usedBy(own.id)).toEqual([]);
  });

  it('name the other garage, whatever its status', async () => {
    const own = await garage('Atelier Dinamo', '18547290');
    await garage('Service Dobre', '18547290', 'suspended');

    expect(await usedBy(own.id)).toEqual(['Service Dobre']);
  });

  it('are sorted by name in Romanian order, then by id', async () => {
    const own = await garage('Atelier Dinamo', '18547290');
    await garage('Ștefan Auto', '18547290', 'approved');
    await garage('Service Dobre', '18547290');
    await Promise.all([
      garage('Auto Ion', '18547290'),
      garage('Auto Ion', '18547290'),
    ]);

    const names = await usedBy(own.id);

    expect(names).toEqual([
      'Auto Ion',
      'Auto Ion',
      'Service Dobre',
      'Ștefan Auto',
    ]);
  });
});
