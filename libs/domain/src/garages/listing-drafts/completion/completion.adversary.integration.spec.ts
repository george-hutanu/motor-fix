import { randomUUID } from 'node:crypto';

import type { CompletionCopyDto } from '@motor-fix/contracts';
import { HttpException } from '@nestjs/common';

import { completionWorld, type Listed } from './completion.testing';
import { serialDatabase } from '../../../auth/serial-db.testing';
import {
  databaseUrl,
  fixtures,
} from '../../../notifications/notifications.testing';

const { account, prisma } = fixtures();
serialDatabase(databaseUrl);
const {
  completion: service,
  listed,
  plain,
  reset,
  submit,
} = completionWorld(prisma);

let garage: Listed;

async function asked(items: string[]) {
  await prisma.verificationFile.update({
    data: {
      decidedAt: new Date(),
      reasonNote: 'Adaugă ce lipsește.',
      requestedItems: items,
      status: 'more_requested',
    },
    where: { id: garage.fileId },
  });
}

const refusalOf = async (promise: Promise<unknown>) => {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  if (!(error instanceof HttpException)) throw error ?? new Error('resolved');
  return {
    body: error.getResponse() as Record<string, unknown>,
    status: error.getStatus(),
  };
};

const send = (copy: CompletionCopyDto, key = randomUUID()) =>
  submit.submit(garage.owner, copy.id, copy.token, key);

async function store(copy: CompletionCopyDto, data: unknown) {
  await prisma.listingDraft.update({
    data: { data: data as never },
    where: { id: copy.id },
  });
}

const fileOf = () =>
  prisma.verificationFile.findUniqueOrThrow({ where: { id: garage.fileId } });

beforeEach(async () => {
  await reset();
  garage = await listed(account, 'ana', plain());
});
afterAll(() => prisma.$disconnect());

// @traces 208-FR-004
describe('opening the copy over and over', () => {
  it('answers the one copy on every call, never edited, and keeps a single row', async () => {
    await asked([]);

    const copies = [];
    for (let i = 0; i < 5; i++) copies.push(await service.open(garage.owner));

    expect(new Set(copies.map((c) => c.id)).size).toBe(1);
    expect(copies.map((c) => c.edited)).toEqual([
      false,
      false,
      false,
      false,
      false,
    ]);
    expect(copies[0]?.requestedItems).toEqual([]);
    expect(copies[0]?.step).toBe(1);
    expect(
      await prisma.listingDraft.count({
        where: { verificationFileId: garage.fileId },
      }),
    ).toBe(1);
    expect(
      await prisma.listingDraftToken.count({
        where: { draftId: copies[0]?.id, kind: 'browser' },
      }),
    ).toBe(4);
  });

  it('opens a new copy for a second request, and leaves the sent one sent', async () => {
    await asked(['photos']);
    const first = await service.open(garage.owner);
    await send(first);
    expect(await refusalOf(service.open(garage.owner))).toMatchObject({
      body: {
        code: 'verification_transition_refused',
        currentStatus: 'submitted',
      },
      status: 409,
    });

    await asked(['other']);
    const second = await service.open(garage.owner);

    expect(second.id).not.toBe(first.id);
    expect(
      (await prisma.listingDraft.findUniqueOrThrow({ where: { id: first.id } }))
        .status,
    ).toBe('submitted');
    expect(second.edited).toBe(false);
  });
});

// @traces 208-FR-007
describe('sending the copy twice at once', () => {
  it('lets one key win and refuses the other with the status, writing one sending', async () => {
    await asked(['photos']);
    const copy = await service.open(garage.owner);

    const results = await Promise.allSettled([send(copy), send(copy)]);

    const ok = results.filter((r) => r.status === 'fulfilled');
    const failed = results.filter((r) => r.status === 'rejected');
    expect(ok).toHaveLength(1);
    expect(failed).toHaveLength(1);
    const error = (failed[0] as PromiseRejectedResult).reason;
    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getResponse()).toMatchObject({
      code: 'verification_transition_refused',
      currentStatus: 'submitted',
    });
    expect(
      await prisma.activityLog.count({
        where: { kind: 'verification_resent', subjectId: garage.fileId },
      }),
    ).toBe(1);
    expect(
      await prisma.outboxEvent.count({
        where: { kind: 'verification.submitted', subjectId: garage.fileId },
      }),
    ).toBe(2);
  });

  it('answers 409 to a second key once the first has sent', async () => {
    await asked(['photos']);
    const copy = await service.open(garage.owner);
    await send(copy);

    expect(await refusalOf(send(copy))).toMatchObject({
      body: {
        code: 'verification_transition_refused',
        currentStatus: 'submitted',
      },
      status: 409,
    });
  });
});

// @traces 208-FR-007
describe('a copy whose sections were cleared', () => {
  it.each([
    ['null', null],
    ['a string', 'x'],
    ['a number', 7],
    ['an array', []],
  ])(
    'answers 422 for a step 1, 3 and 4 that is %s, writing nothing',
    async (_, bad) => {
      await asked(['other']);
      const copy = await service.open(garage.owner);
      const steps = copy.data.steps ?? {};
      for (const step of ['1', '3', '4']) {
        await store(copy, { ...copy.data, steps: { ...steps, [step]: bad } });

        const refused = await refusalOf(send(copy));

        expect(refused.status).toBe(422);
        expect(refused.body).toMatchObject({ code: 'validation_failed' });
      }
      expect((await fileOf()).status).toBe('more_requested');
      expect(
        (
          await prisma.garage.findUniqueOrThrow({
            where: { id: garage.garageId },
          })
        ).name,
      ).toBe('Service Popescu');
    },
  );

  it('answers 422 for a copy whose data is not an object', async () => {
    await asked(['other']);
    const copy = await service.open(garage.owner);
    await store(copy, null);

    const refused = await refusalOf(send(copy));

    expect(refused.status).toBe(422);
    expect((await fileOf()).status).toBe('more_requested');
  });

  it('answers 422 for a name of whitespace only', async () => {
    await asked(['other']);
    const copy = await service.open(garage.owner);
    const steps = copy.data.steps ?? {};
    await store(copy, {
      ...copy.data,
      steps: { ...steps, '1': { ...steps['1'], name: '   ' } },
    });

    expect((await refusalOf(send(copy))).status).toBe(422);
    expect(
      (
        await prisma.garage.findUniqueOrThrow({
          where: { id: garage.garageId },
        })
      ).name,
    ).toBe('Service Popescu');
  });
});

// @traces 208-FR-006 208-FR-007
describe('what a copy without photos or documents leaves on the garage', () => {
  it('refuses a copy with no photo left, as a first sending would, keeping the photo row', async () => {
    await asked(['photos']);
    const copy = await service.open(garage.owner);
    await store(copy, { ...copy.data, files: [] });

    const refused = await refusalOf(send(copy));

    expect(refused).toMatchObject({
      body: { code: 'validation_failed' },
      status: 422,
    });
    expect(
      await prisma.garagePhoto.count({ where: { garageId: garage.garageId } }),
    ).toBe(1);
    expect((await fileOf()).status).toBe('more_requested');
  });

  it('keeps both documents current when the copy no longer holds them', async () => {
    await asked(['other']);
    const copy = await service.open(garage.owner);
    await store(copy, { ...copy.data, documents: {} });

    await send(copy);

    const rows = await prisma.legalDocument.findMany({
      where: { verificationFileId: garage.fileId },
    });
    expect(
      rows.map((r) => `${r.kind}:${r.replacedAt === null}`).sort(),
    ).toEqual(['onrc_certificate:true', 'rar_authorisation:true']);
  });

  it('keeps exactly one current document per kind and every older row across two requests', async () => {
    for (let round = 0; round < 2; round++) {
      await asked(['documents']);
      const copy = await service.open(garage.owner);
      await store(copy, {
        ...copy.data,
        documents: {
          ...copy.data.documents,
          onrc_certificate: {
            pages: [`listing-documents/${randomUUID()}/p1`],
          },
        },
      });
      await send(copy);
    }

    const rows = await prisma.legalDocument.findMany({
      where: { kind: 'onrc_certificate', verificationFileId: garage.fileId },
    });
    expect(rows).toHaveLength(3);
    expect(rows.filter((r) => r.replacedAt === null)).toHaveLength(1);
    const pages = rows.flatMap((r) => r.pages);
    expect(new Set(pages).size).toBe(pages.length);
  });

  it('leaves the old pages of a replaced document on its row', async () => {
    await asked(['documents']);
    const copy = await service.open(garage.owner);
    const old = await prisma.legalDocument.findFirstOrThrow({
      where: { kind: 'onrc_certificate', verificationFileId: garage.fileId },
    });
    await store(copy, {
      ...copy.data,
      documents: {
        ...copy.data.documents,
        onrc_certificate: { pages: [`listing-documents/${randomUUID()}/p1`] },
      },
    });

    await send(copy);

    const kept = await prisma.legalDocument.findUniqueOrThrow({
      where: { id: old.id },
    });
    expect(kept.pages).toEqual(old.pages);
    expect(kept.replacedAt).not.toBeNull();
  });
});
