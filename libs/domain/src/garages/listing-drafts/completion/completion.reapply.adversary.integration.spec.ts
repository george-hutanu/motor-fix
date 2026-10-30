import { randomUUID } from 'node:crypto';

import type { CompletionCopyDto, ListingDraftData } from '@motor-fix/contracts';
import { HttpException } from '@nestjs/common';

import { completionWorld, type Listed } from './completion.testing';
import { newToken } from '../../../auth/email-confirmation/email-confirmation';
import { serialDatabase } from '../../../auth/serial-db.testing';
import type { NotificationsService } from '../../../notifications/notifications.service';
import {
  databaseUrl,
  fixtures,
} from '../../../notifications/notifications.testing';
import type { StorageService } from '../../../storage/storage.service';
import { ListingDraftSweep } from '../../listing-draft-sweep';

const { account, prisma } = fixtures();
serialDatabase(databaseUrl);
const {
  completion: service,
  listed,
  plain,
  reject,
  reset,
  submit,
} = completionWorld(prisma);

const sweep = new ListingDraftSweep(
  prisma,
  {} as unknown as NotificationsService,
  { deleteWithCopies: async () => undefined } as unknown as StorageService,
  'https://motorfix.test',
);

let garage: Listed;

const refusalOf = async (promise: Promise<unknown>) => {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  if (!(error instanceof HttpException)) throw error ?? new Error('answered');
  return {
    body: error.getResponse() as Record<string, unknown>,
    status: error.getStatus(),
  };
};

const send = (copy: CompletionCopyDto, key = randomUUID()) =>
  submit.submit(garage.owner, copy.id, copy.token, key);

const filesOf = () =>
  prisma.verificationFile.findMany({
    orderBy: { createdAt: 'asc' },
    where: { garageId: garage.garageId },
  });

async function store(copy: CompletionCopyDto, data: ListingDraftData) {
  await prisma.listingDraft.update({
    data: { data: data as never },
    where: { id: copy.id },
  });
}

beforeEach(async () => {
  await reset();
  garage = await listed(account, 'ana', plain());
  await reject(garage.fileId, 'address', 'Adresa nu se potrivește.');
});
afterAll(() => prisma.$disconnect());

// @traces 1273-FR-003
describe('opening the correction copy in every other state', () => {
  it.each(['submitted', 'in_review', 'approved'] as const)(
    'answers 409 with %s as the current status, and writes no copy',
    async (status) => {
      await prisma.verificationFile.update({
        data: { status },
        where: { id: garage.fileId },
      });

      const refused = await refusalOf(service.open(garage.owner));

      expect(refused.status).toBe(409);
      expect(refused.body).toMatchObject({
        code: 'verification_transition_refused',
        currentStatus: status,
      });
      expect(
        await prisma.listingDraft.count({
          where: { verificationFileId: garage.fileId },
        }),
      ).toBe(0);
    },
  );

  it('opens at the first step with the other item for a rejection with no reason code and an astral note of 1000 code points', async () => {
    await prisma.verificationFile.update({
      data: { reasonCode: null, reasonNote: '🚗'.repeat(1000) },
      where: { id: garage.fileId },
    });

    const copy = await service.open(garage.owner);

    expect(copy.requestedItems).toEqual(['other']);
    expect(copy.step).toBe(1);
  });
});

// @traces 1273-FR-003
describe('the sweep over correction copies', () => {
  const aged = async (copy: CompletionCopyDto) => {
    const old = new Date(Date.now() - 200 * 24 * 3600 * 1000);
    await prisma.listingDraft.update({
      data: { updatedAt: old },
      where: { id: copy.id },
    });
  };
  const exists = async (id: string) =>
    (await prisma.listingDraft.findUnique({ where: { id } })) !== null;

  it('keeps the copy of the newest rejected file however long it sat untouched', async () => {
    const copy = await service.open(garage.owner);
    await aged(copy);

    await sweep.cleanUp(new Date());

    expect(await exists(copy.id)).toBe(true);
  });

  it.each(['in_review', 'approved', 'submitted'] as const)(
    'removes the copy once its file was reopened to %s',
    async (status) => {
      const copy = await service.open(garage.owner);
      await prisma.verificationFile.update({
        data: { status },
        where: { id: garage.fileId },
      });

      await sweep.cleanUp(new Date());

      expect(await exists(copy.id)).toBe(false);
    },
  );

  it('keeps the copy through a second sweep on the same day', async () => {
    const copy = await service.open(garage.owner);

    await sweep.cleanUp(new Date());
    await sweep.cleanUp(new Date());

    expect(await exists(copy.id)).toBe(true);
  });
});

// @traces 1273-FR-004
describe('sending the correction in unusual ways', () => {
  it('keeps the held documents when the copy no longer lists any', async () => {
    const copy = await service.open(garage.owner);
    await store(copy, { ...copy.data, documents: {} });

    await send(copy);

    const [, next] = await filesOf();
    const rows = await prisma.legalDocument.findMany({
      orderBy: { kind: 'asc' },
      where: { replacedAt: null, verificationFileId: next?.id },
    });
    expect(rows.map((row) => row.kind)).toEqual([
      'onrc_certificate',
      'rar_authorisation',
    ]);
  });

  it('does not carry a document the rejected file already replaced', async () => {
    const current = await prisma.legalDocument.findFirstOrThrow({
      where: { kind: 'onrc_certificate', verificationFileId: garage.fileId },
    });
    const { id: _id, ...rest } = current;
    await prisma.legalDocument.create({
      data: { ...rest, replacedAt: new Date() },
    });
    const copy = await service.open(garage.owner);

    await send(copy);

    const [, next] = await filesOf();
    expect(
      await prisma.legalDocument.count({
        where: { verificationFileId: next?.id },
      }),
    ).toBe(2);
  });

  it('writes a name with astral and accented characters to the garage as sent', async () => {
    const copy = await service.open(garage.owner);
    const steps = copy.data.steps ?? {};
    await store(copy, {
      ...copy.data,
      steps: {
        ...steps,
        '1': { ...steps['1'], name: 'Service Țăndărică 🚗' } as never,
      },
    });

    await send(copy);

    const row = await prisma.garage.findUniqueOrThrow({
      where: { id: garage.garageId },
    });
    expect(row.name).toBe('Service Țăndărică 🚗');
  });

  it('makes one file when two different keys send the same copy at once', async () => {
    const copy = await service.open(garage.owner);

    const results = await Promise.allSettled([send(copy), send(copy)]);

    expect(results.map((r) => r.status).sort()).toEqual([
      'fulfilled',
      'rejected',
    ]);
    expect(await filesOf()).toHaveLength(2);
  });

  it('answers the same file to the key again after the new file was approved', async () => {
    const copy = await service.open(garage.owner);
    const key = randomUUID();
    const first = await send(copy, key);
    await prisma.verificationFile.update({
      data: { status: 'approved' },
      where: { previousFileId: garage.fileId },
    });

    const again = await send(copy, key);

    expect(again.fileId).toBe(first.fileId);
    expect(await filesOf()).toHaveLength(2);
  });
});

// @traces 1273-FR-005
describe('refusing a correction that is out of date', () => {
  it('answers 409 with in_review when the rejected file was reopened after the copy opened, writing nothing', async () => {
    const copy = await service.open(garage.owner);
    await prisma.verificationFile.update({
      data: { status: 'in_review' },
      where: { id: garage.fileId },
    });

    const refused = await refusalOf(send(copy));

    expect(refused.status).toBe(409);
    expect(refused.body).toMatchObject({
      code: 'verification_transition_refused',
      currentStatus: 'in_review',
    });
    expect(await filesOf()).toHaveLength(1);
  });

  it('answers 409 with the newest file’s status for the first copy once the second file is rejected too', async () => {
    const first = await service.open(garage.owner);
    await send(first);
    const second = await prisma.verificationFile.findUniqueOrThrow({
      where: { previousFileId: garage.fileId },
    });
    await reject(second.id, 'photos', 'Poze neclare.');

    const refused = await refusalOf(send(first));

    expect(refused.status).toBe(409);
    expect(refused.body).toMatchObject({ currentStatus: 'rejected' });
    expect(await filesOf()).toHaveLength(2);
  });

  it('refuses the owner’s fresh visitor draft with garage_already_exists and adds no garage', async () => {
    const token = newToken();
    const row = await prisma.listingDraft.create({
      data: {
        data: plain() as never,
        email: 'ana2@example.test',
        language: 'ro',
        step: 6,
        tokens: {
          create: { hash: token.hash, kind: 'browser', sentAt: new Date() },
        },
        updatedAt: new Date(),
      },
    });

    const refused = await refusalOf(
      submit.submit(garage.owner, row.id, token.token, randomUUID()),
    );

    expect(refused.status).toBe(409);
    expect(refused.body).toMatchObject({ code: 'garage_already_exists' });
    expect(await prisma.garage.count()).toBe(1);
    expect(await filesOf()).toHaveLength(1);
  });
});
