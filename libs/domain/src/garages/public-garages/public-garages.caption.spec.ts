import { PublicGaragesService } from './public-garages';
import type { CacheService } from '../../cache/cache.service';
import type { PrismaClient } from '../../generated/prisma/client';
import type { StorageService } from '../../storage/storage.service';

// @traces 1249-FR-011

const photo = (id: string, caption?: string | null) => ({
  fileKey: `garage_photo/g1/${id}`,
  height: 600,
  id,
  width: 800,
  ...(caption !== undefined && { caption }),
});

function build() {
  const statements: string[] = [];
  const prisma = {
    $queryRaw: vi.fn((strings: TemplateStringsArray) => {
      statements.push(strings.join('?'));
      return Promise.resolve([]);
    }),
  } as unknown as PrismaClient;
  const cache = {
    read: vi.fn(async (spec: { read: () => Promise<{ value: unknown }> }) => {
      const filled = await spec.read();
      return filled.value;
    }),
  } as unknown as CacheService;
  const storage = {
    createDownloadUrl: vi.fn().mockResolvedValue('https://signed'),
    derivedKey: (key: string, kind: string) => `${key}.${kind}`,
    metadataOf: vi.fn().mockResolvedValue(null),
  } as unknown as StorageService;
  return {
    service: new PublicGaragesService(prisma, cache, storage),
    statements,
  };
}

describe("the public profile's photo captions", () => {
  it('reads each photo caption in the profile statement', async () => {
    const { service, statements } = build();

    await service.bySlug('garage').catch(() => undefined);

    expect(statements.join('\n')).toMatch(/'caption',\s*ph\.caption/);
  });

  it('answers a caption where the owner gave one, and none otherwise', async () => {
    const { service } = build();

    const photos = await service.photos([
      photo('a', 'Hala de reparații'),
      photo('b', null),
      photo('c'),
    ]);

    expect(photos.map((p) => p.caption)).toEqual([
      'Hala de reparații',
      undefined,
      undefined,
    ]);
    expect(photos[1]).not.toHaveProperty('caption');
  });
});
