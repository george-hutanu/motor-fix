import { randomBytes, randomUUID } from 'node:crypto';
import { crc32 } from 'node:zlib';

import type { Role } from '@motor-fix/contracts/capabilities';
import { HttpException } from '@nestjs/common';
import { Queue } from 'bullmq';

import { OwnerPhotosSave } from './owner-photos.save';
import { OwnerPhotosService } from './owner-photos.service';
import { AuditService } from '../../../audit/audit.service';
import type { Actor } from '../../../auth/policy';
import { outbox } from '../../../events/event.port';
import type { PrismaClient } from '../../../generated/prisma/client';
import { redisUrlFor } from '../../../notifications/notifications.testing';
import type { RateLimits } from '../../../rate-limit/rate-limit.service';
import { S3TestStore } from '../../../storage/s3-test-store';
import { StorageService } from '../../../storage/storage.service';
import type { ListingDraftsService } from '../../listing-drafts/listing-drafts.service';
import {
  LISTING_PHOTOS_QUEUE,
  ListingPhotosService,
} from '../listing-photos/listing-photos.service';

export const JPEG = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49,
]);
export const checksumOf = (file: Buffer) => {
  const sum = Buffer.alloc(4);
  sum.writeUInt32BE(crc32(file));
  return sum.toString('base64');
};

export const refusalOf = async (promise: Promise<unknown>) => {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  if (!(error instanceof HttpException)) throw new Error('not refused');
  return {
    body: error.getResponse() as {
      code: string;
      errors?: { code: string; field: string }[];
    },
    status: error.getStatus(),
  };
};

// The gallery's services on a real database, object store and queue; the
// rate limit is proven by the unit spec, so `limits` admits every call
// unless a test swaps its `take`.
export function ownerPhotosWorld(prisma: PrismaClient) {
  const store = new S3TestStore();
  const queue = new Queue(LISTING_PHOTOS_QUEUE, {
    connection: { url: redisUrlFor(14) },
  });
  const limits = { take: vi.fn(async () => undefined) };
  const audit = new AuditService();
  const parts = {} as {
    storage: StorageService;
    service: OwnerPhotosService;
    save: OwnerPhotosSave;
  };

  beforeAll(async () => {
    await store.start();
    parts.storage = new StorageService(store.env());
    const listing = new ListingPhotosService(
      prisma,
      {} as ListingDraftsService,
      parts.storage,
      queue,
      limits as unknown as RateLimits,
    );
    parts.service = new OwnerPhotosService(
      prisma,
      parts.storage,
      listing,
      limits as unknown as RateLimits,
    );
    parts.save = new OwnerPhotosSave(
      prisma,
      audit,
      outbox,
      parts.storage,
      listing,
      parts.service,
    );
  });

  afterAll(async () => {
    parts.storage.onApplicationShutdown();
    await store.stop();
    await queue.close();
  });

  beforeEach(async () => {
    store.objects.clear();
    store.beforeDelete = undefined;
    limits.take.mockReset();
    await queue.obliterate({ force: true });
  });

  // A photo whose copies the worker has made.
  async function processed(key: string) {
    await parts.storage.putObject(key, JPEG, 'image/jpeg');
    await parts.storage.putObject(`${key}.thumb`, JPEG, 'image/jpeg', {
      digest: randomBytes(32).toString('hex'),
      height: '600',
      thumbhash: 'HBkSHYSIeHiPiHh8eJd4eTN0EEQG',
      width: '800',
    });
    await parts.storage.putObject(`${key}.display`, JPEG, 'image/jpeg');
  }

  // An upload signed, sent and confirmed for the garage.
  async function confirmed(as: Actor, garageId: string) {
    const address = await parts.service.uploadAddress(as, garageId, {
      checksum: checksumOf(JPEG),
      contentType: 'image/jpeg',
      size: JPEG.length,
    });
    const put = await fetch(address.url, {
      body: new Uint8Array(JPEG),
      headers: address.headers,
      method: 'PUT',
    });
    if (put.status !== 200) throw new Error(`upload answered ${put.status}`);
    return parts.service.confirm(as, garageId, address.key);
  }

  return { confirmed, limits, parts, processed, queue, store };
}

const actorOf = (accountId: string, role: Role, garageId: string): Actor => ({
  accountId,
  garageId,
  permissions: {
    canAnswerQuotes: false,
    canMoveBookings: false,
    canRecordFinalPrice: false,
  },
  role,
  roles: [role],
});

// Service Auto Nord with its owner, a receptionist, a mechanic and three
// saved photos A, B (captioned) and C; Atelier Dinamo with its owner.
export async function galleryWorld(
  prisma: PrismaClient,
  account: (name: string, roles: Role[]) => Promise<string>,
  processed: (key: string) => Promise<void>,
  status: 'approved' | 'draft' | 'suspended' = 'approved',
) {
  const nord = await prisma.garage.create({
    data: { name: 'Service Auto Nord', slug: `nord-${randomUUID()}`, status },
  });
  const dinamo = await prisma.garage.create({
    data: {
      name: 'Atelier Dinamo',
      slug: `dinamo-${randomUUID()}`,
      status: 'approved',
    },
  });
  const mihai = await account('mihai', ['garage']);
  const ioana = await account('ioana', ['receptionist']);
  const vlad = await account('vlad', ['mechanic']);
  const radu = await account('radu', ['garage']);
  const draft = randomUUID();
  const keys = [0, 1, 2].map(() => `garage_photo/${draft}/${randomUUID()}`);
  for (const key of keys) await processed(key);
  const rows = await prisma.garagePhoto.createManyAndReturn({
    data: keys.map((fileKey, position) => ({
      caption: position === 1 ? 'Hala' : null,
      fileKey,
      garageId: nord.id,
      height: 600,
      position,
      width: 800,
    })),
  });
  type Row = (typeof rows)[number];
  const [a, b, c] = rows as [Row, Row, Row];
  return {
    a,
    b,
    c,
    mechanic: actorOf(vlad, 'mechanic', nord.id),
    nord,
    other: actorOf(radu, 'garage', dinamo.id),
    owner: actorOf(mihai, 'garage', nord.id),
    receptionist: actorOf(ioana, 'receptionist', nord.id),
  };
}
