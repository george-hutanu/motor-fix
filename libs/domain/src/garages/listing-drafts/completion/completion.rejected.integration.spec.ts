import { randomUUID } from 'node:crypto';

import type { CompletionCopyDto, ListingDraftData } from '@motor-fix/contracts';
import { HttpException, Logger } from '@nestjs/common';

import { copyOf } from './completion.copy';
import { completionWorld, type Listed } from './completion.testing';
import type { Actor } from '../../../auth/policy';
import { serialDatabase } from '../../../auth/serial-db.testing';
import type { CacheService } from '../../../cache/cache.service';
import {
  databaseUrl,
  fixtures,
} from '../../../notifications/notifications.testing';
import type { StorageService } from '../../../storage/storage.service';
import { DocumentCycleService } from '../../documents/document-cycle/document-cycle.service';
import { PublicGaragesService } from '../../public-garages/public-garages';
import { resubmission } from '../../verification/verification.service';
import { VerificationFileService } from '../../verification/verification-file/verification-file.service';

const { account, prisma } = fixtures();
serialDatabase(databaseUrl);
const {
  completion: service,
  drafts,
  listed,
  plain,
  reject,
  reset,
  submit,
} = completionWorld(prisma);

let garage: Listed;

const NOTE = 'Adresa nu se potrivește cu certificatul ONRC.';

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

type Steps = NonNullable<ListingDraftData['steps']>;

// The copy saved with `change` applied to its data, as the form saves it.
async function saved(
  copy: CompletionCopyDto,
  change: (data: ListingDraftData, steps: Steps) => ListingDraftData,
) {
  const data = change(copy.data, copy.data.steps ?? {});
  await prisma.listingDraft.update({
    data: {
      data: {
        ...copy.data,
        documents: { ...copy.data.documents, ...data.documents },
        files: data.files ?? [],
      } as never,
    },
    where: { id: copy.id },
  });
  await drafts.save(copy.id, copy.token, { data, language: 'ro', step: 1 });
}

const send = (
  copy: CompletionCopyDto,
  actor = garage.owner,
  key = randomUUID(),
) => submit.submit(actor, copy.id, copy.token, key);

const staff = (role: 'mechanic' | 'receptionist'): Actor => ({
  ...garage.owner,
  role,
  roles: [role],
});
const outsider = (): Actor => ({
  ...garage.owner,
  garageId: null,
  role: 'driver',
});

const rejectedFile = () =>
  prisma.verificationFile.findUniqueOrThrow({ where: { id: garage.fileId } });
const filesOf = () =>
  prisma.verificationFile.findMany({
    orderBy: { createdAt: 'asc' },
    where: { garageId: garage.garageId },
  });
const newFile = () =>
  prisma.verificationFile.findUniqueOrThrow({
    where: { previousFileId: garage.fileId },
  });
const copiesOf = (fileId: string) =>
  prisma.listingDraft.count({ where: { verificationFileId: fileId } });

// Everything a refused send must leave as it found it.
async function snapshot() {
  return {
    entries: await prisma.activityLog.count({
      where: { garageId: garage.garageId },
    }),
    files: await filesOf(),
    garage: await prisma.garage.findUniqueOrThrow({
      where: { id: garage.garageId },
    }),
    outbox: await prisma.outboxEvent.count(),
  };
}

beforeEach(async () => {
  await reset();
  garage = await listed(account, 'ana', plain());
  await reject(garage.fileId, 'address', NOTE);
});
afterAll(() => prisma.$disconnect());

// @traces 1273-FR-003
describe('opening the copy of a rejected garage', () => {
  it('answers the owner a copy of the garage bound to the rejected file, at the step its reason names', async () => {
    const copy = await service.open(garage.owner);

    expect(copy).toMatchObject({
      edited: false,
      held: [
        { issuedOn: null, kind: 'onrc_certificate', pages: 1 },
        { issuedOn: null, kind: 'rar_authorisation', pages: 1 },
      ],
      requestedItems: ['address'],
      status: 'open',
      step: 5,
    });
    expect(copy.data).toEqual(await copyOf(prisma, garage.garageId));
    const row = await prisma.listingDraft.findUniqueOrThrow({
      where: { id: copy.id },
    });
    expect(row.verificationFileId).toBe(garage.fileId);
  });

  it('starts at the step of each reason, and at the first for a reason it does not know', async () => {
    const stepFor = async (reason: string) => {
      await prisma.listingDraft.deleteMany({
        where: { verificationFileId: garage.fileId },
      });
      await reject(garage.fileId, reason, NOTE);
      const copy = await service.open(garage.owner);
      return [copy.requestedItems, copy.step];
    };

    expect(await stepFor('documents')).toEqual([['documents'], 6]);
    expect(await stepFor('rar')).toEqual([['rar'], 6]);
    expect(await stepFor('photos')).toEqual([['photos'], 5]);
    expect(await stepFor('other')).toEqual([['other'], 1]);
    expect(await stepFor('Motiv scris înainte de coduri')).toEqual([
      ['other'],
      1,
    ]);
  });

  it('answers the same copy again, with the owner’s edits kept', async () => {
    const first = await service.open(garage.owner);
    await saved(first, (data, steps) => ({
      ...data,
      steps: { ...steps, '1': { ...steps['1'], phone: '0733 000 111' } },
    }));

    const again = await service.open(garage.owner);

    expect(again.id).toBe(first.id);
    expect(again.edited).toBe(true);
    expect(again.data.steps?.['1']?.phone).toBe('0733 000 111');
    expect(await copiesOf(garage.fileId)).toBe(1);
  });

  it('refuses the garage staff who are not its owner, and anyone outside the garage', async () => {
    for (const role of ['mechanic', 'receptionist'] as const) {
      expect(await refusalOf(service.open(staff(role)))).toMatchObject({
        body: { code: 'forbidden' },
        status: 403,
      });
    }
    expect(await refusalOf(service.open(outsider()))).toMatchObject({
      body: { code: 'not_found' },
      status: 404,
    });
    expect(await copiesOf(garage.fileId)).toBe(0);
  });

  it.each(['submitted', 'in_review', 'approved'])(
    'answers 409 with the status once the newest file is %s',
    async (status) => {
      await prisma.verificationFile.update({
        data: { status: status as never },
        where: { id: garage.fileId },
      });

      expect(await refusalOf(service.open(garage.owner))).toMatchObject({
        body: {
          code: 'verification_transition_refused',
          currentStatus: status,
        },
        status: 409,
      });
      expect(await copiesOf(garage.fileId)).toBe(0);
    },
  );

  it('answers 409 with the newer file’s status once a file follows the rejected one', async () => {
    await prisma.verificationFile.create({
      data: { garageId: garage.garageId, previousFileId: garage.fileId },
    });

    expect(await refusalOf(service.open(garage.owner))).toMatchObject({
      body: {
        code: 'verification_transition_refused',
        currentStatus: 'submitted',
      },
      status: 409,
    });
  });
});

// @traces 1273-FR-004 1273-FR-006 1273-FR-009
describe('sending the corrected copy', () => {
  it('creates one new submitted file after the rejected one, the garage and its owner left as they are', async () => {
    const before = await rejectedFile();
    const garages = await prisma.garage.count();
    const members = await prisma.garageMember.count({
      where: { garageId: garage.garageId, role: 'owner' },
    });
    const copy = await service.open(garage.owner);
    await saved(copy, (data, steps) => ({
      ...data,
      steps: { ...steps, '1': { ...steps['1'], phone: '0733 000 111' } },
    }));

    const sent = await send(copy);

    const next = await newFile();
    expect(sent).toEqual({
      fileId: next.id,
      garageId: garage.garageId,
      status: 'submitted',
      warnings: [],
    });
    expect(next).toMatchObject({
      decidedAt: null,
      previousFileId: garage.fileId,
      reasonCode: null,
      reasonNote: null,
      status: 'submitted',
    });
    expect(resubmission(next)).toBe(false);
    expect(await rejectedFile()).toEqual(before);
    expect(await filesOf()).toHaveLength(2);
    expect(await prisma.garage.count()).toBe(garages);
    expect(
      await prisma.garageMember.count({
        where: { garageId: garage.garageId, role: 'owner' },
      }),
    ).toBe(members);
    expect(
      await prisma.garage.findUniqueOrThrow({
        where: { id: garage.garageId },
      }),
    ).toMatchObject({ phone: '+40733000111', status: 'draft' });
    expect(
      await prisma.activityLog.findMany({
        where: { field: 'phone', subjectId: garage.garageId },
      }),
    ).toEqual([
      expect.objectContaining({
        newValue: '+40733000111',
        oldValue: '+40722123456',
      }),
    ]);
    const events = await prisma.outboxEvent.findMany({
      where: { kind: 'verification.submitted', subjectId: next.id },
    });
    expect(events.map((event) => event.payload)).toEqual([
      { fileId: next.id, garageId: garage.garageId },
    ]);
    expect(
      await prisma.listingDraft.findUniqueOrThrow({ where: { id: copy.id } }),
    ).toMatchObject({ status: 'submitted' });
  });

  it('carries the held documents, the declaration and the RAR number onto the new file', async () => {
    const held = await prisma.legalDocument.findMany({
      orderBy: { kind: 'asc' },
      where: { verificationFileId: garage.fileId },
    });
    const before = await rejectedFile();
    const copy = await service.open(garage.owner);
    const page = `listing-documents/${randomUUID()}/p1`;
    await saved(copy, (data) => ({
      ...data,
      documents: { onrc_certificate: { pages: [page] } },
    }));

    await send(copy);

    const next = await newFile();
    expect(
      await prisma.legalDocument.findMany({
        orderBy: { kind: 'asc' },
        where: { verificationFileId: garage.fileId },
      }),
    ).toEqual(held);
    const rows = await prisma.legalDocument.findMany({
      orderBy: { kind: 'asc' },
      where: { verificationFileId: next.id },
    });
    const rar = held.find((row) => row.kind === 'rar_authorisation');
    expect(rows).toEqual([
      expect.objectContaining({
        kind: 'onrc_certificate',
        pages: [page],
        replacedAt: null,
      }),
      expect.objectContaining({
        kind: 'rar_authorisation',
        pages: rar?.pages,
        replacedAt: null,
      }),
    ]);
    const [onrc, carried] = rows;
    expect(
      await prisma.outboxEvent.count({
        where: { kind: 'document.uploaded', subjectId: onrc?.id },
      }),
    ).toBe(1);
    expect(
      await prisma.outboxEvent.count({
        where: { kind: 'document.uploaded', subjectId: carried?.id },
      }),
    ).toBe(0);
    expect(
      await prisma.activityLog.findMany({
        where: { subjectId: carried?.id },
      }),
    ).toEqual([expect.objectContaining({ action: 'create' })]);
    expect(next).toMatchObject({
      declaredAt: before.declaredAt,
      declaredByName: before.declaredByName,
      rarNumber: before.rarNumber,
    });
  });

  it('stores the RAR number as the first send does, with no change logged for it', async () => {
    const copy = await service.open(garage.owner);
    await saved(copy, (data, steps) => ({
      ...data,
      steps: { ...steps, '6': { ...steps['6'], rarNumber: ' bv-777 ' } },
    }));

    await send(copy);

    const next = await newFile();
    expect(next.rarNumber).toBe('BV-777');
    expect(
      await prisma.activityLog.findMany({
        where: { field: 'rarNumber', subjectId: next.id },
      }),
    ).toEqual([]);
  });

  it('stores the warning on the new file when the new CUI is another garage’s', async () => {
    await prisma.garage.create({
      data: { cui: '12345674', name: 'Atelier Vecin', slug: 'atelier-vecin' },
    });
    const copy = await service.open(garage.owner);
    await saved(copy, (data, steps) => ({
      ...data,
      steps: { ...steps, '6': { ...steps['6'], cui: '12345674' } },
    }));

    const sent = await send(copy);

    expect(sent.warnings).toContainEqual({
      code: 'cui_in_use',
      field: 'steps.6.cui',
    });
    expect(await newFile()).toMatchObject({ cuiWarning: 'Atelier Vecin' });
    expect(await rejectedFile()).toMatchObject({ cuiWarning: null });
  });

  it('logs the new file after the rejected one, without the note', async () => {
    const copy = await service.open(garage.owner);
    const logged = jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => undefined);

    try {
      await send(copy);

      const next = await newFile();
      const lines = logged.mock.calls.map((call) => String(call[0]));
      expect(lines).toContain(
        `file ${next.id} follows rejected file ${garage.fileId} garage ${garage.garageId}`,
      );
      expect(lines.some((line) => line.includes(NOTE))).toBe(false);
    } finally {
      logged.mockRestore();
    }
  });

  it('answers the same result to the same key, making one file', async () => {
    const copy = await service.open(garage.owner);
    const key = randomUUID();

    const first = await send(copy, garage.owner, key);
    const second = await send(copy, garage.owner, key);

    expect(second).toEqual(first);
    expect(await filesOf()).toHaveLength(2);
  });
});

// @traces 1273-FR-005 1273-FR-004
describe('a corrected copy that is refused', () => {
  async function nothingWritten(
    copy: CompletionCopyDto,
    was: Awaited<ReturnType<typeof snapshot>>,
  ) {
    expect(await snapshot()).toEqual(was);
    expect(
      await prisma.listingDraft.findUniqueOrThrow({ where: { id: copy.id } }),
    ).toMatchObject({ status: 'open' });
  }

  it('refuses the staff who are not the owner, and anyone outside the garage', async () => {
    const copy = await service.open(garage.owner);
    const was = await snapshot();

    for (const role of ['mechanic', 'receptionist'] as const) {
      expect(await refusalOf(send(copy, staff(role)))).toMatchObject({
        body: { code: 'forbidden' },
        status: 403,
      });
    }
    expect(await refusalOf(send(copy, outsider()))).toMatchObject({
      status: 404,
    });
    await nothingWritten(copy, was);
  });

  it.each(['submitted', 'in_review', 'approved'])(
    'answers 409 with the status once the file is %s, and writes nothing',
    async (status) => {
      const copy = await service.open(garage.owner);
      await prisma.verificationFile.update({
        data: { status: status as never },
        where: { id: garage.fileId },
      });
      const was = await snapshot();

      expect(await refusalOf(send(copy))).toMatchObject({
        body: {
          code: 'verification_transition_refused',
          currentStatus: status,
        },
        status: 409,
      });
      await nothingWritten(copy, was);
    },
  );

  it('answers 409 with the newer file’s status when a file followed the rejected one meanwhile', async () => {
    const copy = await service.open(garage.owner);
    await prisma.verificationFile.create({
      data: { garageId: garage.garageId, previousFileId: garage.fileId },
    });
    const was = await snapshot();

    expect(await refusalOf(send(copy))).toMatchObject({
      body: {
        code: 'verification_transition_refused',
        currentStatus: 'submitted',
      },
      status: 409,
    });
    await nothingWritten(copy, was);
  });

  it('answers a sent copy’s new key with the status of the file it made', async () => {
    const copy = await service.open(garage.owner);
    await send(copy);

    expect(await refusalOf(send(copy))).toMatchObject({
      body: {
        code: 'verification_transition_refused',
        currentStatus: 'submitted',
      },
      status: 409,
    });
    expect(await filesOf()).toHaveLength(2);
  });

  it('answers 422 with the fields a cleared answer leaves missing, and writes nothing', async () => {
    const copy = await service.open(garage.owner);
    await saved(copy, (data, steps) => ({
      ...data,
      steps: { ...steps, '1': { ...steps['1'], name: '' } },
    }));
    const was = await snapshot();

    const refused = await refusalOf(send(copy));

    expect(refused.status).toBe(422);
    expect(refused.body).toMatchObject({ code: 'validation_failed' });
    expect(refused.body['errors']).toContainEqual(
      expect.objectContaining({ field: 'steps.1.name' }),
    );
    await nothingWritten(copy, was);
  });
});

// The admins' read of a file, its documents' links from a fake store.
const storage = {
  createDownloadUrl: async (key: string) => `https://store.test/${key}`,
  derivedKey: (key: string, copy: string) => `${key}.${copy}`,
  metadataOf: async () => null,
  ready: async () => undefined,
} as unknown as StorageService;
const files = new VerificationFileService(
  prisma,
  storage,
  new PublicGaragesService(prisma, {} as CacheService, storage),
  new DocumentCycleService(prisma),
);

// @traces 1273-FR-007 1273-FR-006
describe('the admin reading the file a correction made', () => {
  const corrected = async () => {
    await send(await service.open(garage.owner));
    return newestFile();
  };
  const newestFile = () =>
    prisma.verificationFile.findFirstOrThrow({
      orderBy: { createdAt: 'desc' },
      where: { garageId: garage.garageId },
    });

  it('sees the earlier rejection, its reason, note and time, on a file that is not marked updated', async () => {
    const rejected = await rejectedFile();

    const next = await corrected();
    const read = await files.read(next.id);

    expect(read.previousRejection).toEqual({
      decidedAt: rejected.decidedAt?.toISOString(),
      reasonCode: 'address',
      reasonNote: NOTE,
    });
    expect(read.file.resubmitted).toBe(false);
  });

  it('sees the second rejection of a garage rejected twice, the chain running through both', async () => {
    const second = await corrected();
    await reject(second.id, 'rar', 'Autorizația RAR a expirat.');

    const third = await corrected();

    expect(third.previousFileId).toBe(second.id);
    expect(second.previousFileId).toBe(garage.fileId);
    expect((await files.read(third.id)).previousRejection).toMatchObject({
      reasonCode: 'rar',
      reasonNote: 'Autorizația RAR a expirat.',
    });
    expect(await rejectedFile()).toMatchObject({
      reasonCode: 'address',
      status: 'rejected',
    });
  });
});
