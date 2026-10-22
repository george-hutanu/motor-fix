import { randomUUID } from 'node:crypto';

import type { CompletionCopyDto, ListingDraftData } from '@motor-fix/contracts';
import { HttpException, Logger } from '@nestjs/common';

import { copyOf } from './completion.copy';
import {
  completionWorld,
  type Listed,
  OWNER_PERMISSIONS,
} from './completion.testing';
import { hashToken } from '../../../auth/email-confirmation/email-confirmation';
import type { Actor } from '../../../auth/policy';
import { serialDatabase } from '../../../auth/serial-db.testing';
import {
  databaseUrl,
  fixtures,
} from '../../../notifications/notifications.testing';
import { LegalDocumentsService } from '../../documents/legal-documents/legal-documents.service';
import { resubmission } from '../../verification/verification.service';

const { account, prisma } = fixtures();
serialDatabase(databaseUrl);
const {
  completion: service,
  drafts,
  listed,
  plain,
  reset,
  submit,
} = completionWorld(prisma);

let garage: Listed;

const NOTE = 'Trimiteți încă o poză a atelierului.';

async function asked(items: string[], status = 'more_requested') {
  await prisma.verificationFile.update({
    data: {
      decidedAt: new Date(),
      reasonNote: NOTE,
      requestedItems: items,
      status: status as never,
    },
    where: { id: garage.fileId },
  });
}

const refusalOf = async (promise: Promise<unknown>) => {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  if (!(error instanceof HttpException)) throw error ?? new Error('opened');
  return {
    body: error.getResponse() as Record<string, unknown>,
    status: error.getStatus(),
  };
};

beforeEach(async () => {
  await reset();
  garage = await listed(account, 'ana', plain());
});
afterAll(() => prisma.$disconnect());

// @traces 208-FR-004, 208-FR-005
describe('opening the copy', () => {
  it('answers the owner a copy of the garage bound to its file, with a key of its own', async () => {
    await asked(['photos']);

    const copy = await service.open(garage.owner);

    expect(copy).toMatchObject({
      edited: false,
      email: 'ana@example.test',
      held: [
        { issuedOn: null, kind: 'onrc_certificate', pages: 1 },
        { issuedOn: null, kind: 'rar_authorisation', pages: 1 },
      ],
      language: 'ro',
      requestedItems: ['photos'],
      status: 'open',
      step: 5,
    });
    expect(copy.data).toEqual(await copyOf(prisma, garage.garageId));
    const row = await prisma.listingDraft.findUniqueOrThrow({
      include: { tokens: true },
      where: { id: copy.id },
    });
    expect(row.verificationFileId).toBe(garage.fileId);
    expect(row.tokens).toEqual([
      expect.objectContaining({ hash: hashToken(copy.token), kind: 'browser' }),
    ]);
  });

  it('starts at the first step asked for', async () => {
    const stepFor = async (items: string[]) => {
      await prisma.listingDraft.deleteMany({
        where: { verificationFileId: garage.fileId },
      });
      await asked(items);
      return (await service.open(garage.owner)).step;
    };

    expect(await stepFor(['documents', 'address'])).toBe(5);
    expect(await stepFor(['rar'])).toBe(6);
    expect(await stepFor(['photos', 'other'])).toBe(1);
    expect(await stepFor([])).toBe(1);
  });

  it('answers the same copy again, with what was saved and a fresh key', async () => {
    await asked(['photos']);
    const first = await service.open(garage.owner);
    const steps = first.data.steps ?? {};
    await drafts.save(first.id, first.token, {
      data: {
        ...first.data,
        steps: { ...steps, '1': { ...steps['1'], knownFor: 'Distribuție' } },
      },
      language: 'ro',
      step: 1,
    });

    const again = await service.open(garage.owner);

    expect(again.id).toBe(first.id);
    expect(again.edited).toBe(true);
    expect(again.data.steps?.['1']?.knownFor).toBe('Distribuție');
    expect(again.token).not.toBe(first.token);
    expect(
      await prisma.listingDraftToken.count({
        where: { draftId: first.id, kind: 'browser' },
      }),
    ).toBe(2);
  });

  it('keeps one copy per file when two opens race, and logs the one it made', async () => {
    await asked(['photos']);
    const logged = jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => undefined);

    const [a, b] = await Promise.all([
      service.open(garage.owner),
      service.open(garage.owner),
    ]);

    expect(a.id).toBe(b.id);
    expect(
      await prisma.listingDraft.count({
        where: { verificationFileId: garage.fileId },
      }),
    ).toBe(1);
    const lines = logged.mock.calls
      .map((call) => String(call[0]))
      .filter((line) => line.startsWith('completion copy'));
    expect(lines).toEqual([
      `completion copy ${a.id} opened for file ${garage.fileId} garage ${garage.garageId}`,
    ]);
    logged.mockRestore();
  });

  it('refuses the garage staff who are not its owner', async () => {
    await asked(['photos']);
    for (const role of ['mechanic', 'receptionist'] as const) {
      const staff: Actor = {
        ...garage.owner,
        permissions: OWNER_PERMISSIONS,
        role,
        roles: [role],
      };
      expect(await refusalOf(service.open(staff))).toMatchObject({
        body: { code: 'forbidden' },
        status: 403,
      });
    }
    expect(
      await prisma.listingDraft.count({
        where: { verificationFileId: garage.fileId },
      }),
    ).toBe(0);
  });

  it('answers 404 to an account with no garage, or a garage with no file', async () => {
    const driver: Actor = { ...garage.owner, garageId: null, role: 'driver' };
    expect(await refusalOf(service.open(driver))).toMatchObject({
      body: { code: 'not_found' },
      status: 404,
    });
    const fileless = await prisma.garage.create({
      data: { name: 'Atelier Nou', slug: 'atelier-nou' },
    });
    const owner = { ...garage.owner, garageId: fileless.id };
    expect(await refusalOf(service.open(owner))).toMatchObject({
      body: { code: 'not_found' },
      status: 404,
    });
  });

  it('answers 409 with the status when the file asks for nothing', async () => {
    const refused = await refusalOf(service.open(garage.owner));

    expect(refused).toMatchObject({
      body: {
        code: 'verification_transition_refused',
        currentStatus: 'submitted',
      },
      status: 409,
    });
    expect(
      await prisma.listingDraft.count({
        where: { verificationFileId: garage.fileId },
      }),
    ).toBe(0);
  });
});

type Steps = NonNullable<ListingDraftData['steps']>;

// The copy saved with `change` applied to its data, as the form saves it.
async function saved(
  copy: CompletionCopyDto,
  change: (data: ListingDraftData, steps: Steps) => ListingDraftData,
) {
  const data = change(copy.data, copy.data.steps ?? {});
  // The photos and pages as the uploads and deletes before the save left them.
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

async function clock() {
  const [{ now }] = await prisma.$queryRaw<
    { now: Date }[]
  >`SELECT clock_timestamp() AS now`;
  return now;
}
const entriesSince = (since: Date) =>
  prisma.activityLog.findMany({
    orderBy: { at: 'asc' },
    where: { at: { gte: since }, garageId: garage.garageId },
  });
const fileOf = () =>
  prisma.verificationFile.findUniqueOrThrow({ where: { id: garage.fileId } });

// @traces 208-FR-007, 208-FR-019
describe('sending the copy again', () => {
  it('sends the file back for verification, keeping what was asked for, the garage still a draft', async () => {
    await asked(['photos']);
    const before = await fileOf();
    const copy = await service.open(garage.owner);
    await saved(copy, (data) => ({
      ...data,
      files: [...(data.files ?? []), `garage-photos/${randomUUID()}/p2`],
    }));

    const sent = await send(copy);

    expect(sent).toEqual({
      fileId: garage.fileId,
      garageId: garage.garageId,
      status: 'submitted',
      warnings: [],
    });
    const file = await fileOf();
    expect(file).toMatchObject({
      reasonNote: NOTE,
      requestedItems: ['photos'],
      status: 'submitted',
    });
    expect(file.submittedAt.getTime()).toBeGreaterThan(
      before.submittedAt.getTime(),
    );
    expect(resubmission(file)).toBe(true);
    expect(
      await prisma.garage.findUniqueOrThrow({
        where: { id: garage.garageId },
      }),
    ).toMatchObject({ status: 'draft' });
    expect(
      await prisma.listingDraft.findUniqueOrThrow({ where: { id: copy.id } }),
    ).toMatchObject({ status: 'submitted' });
    const events = await prisma.outboxEvent.findMany({
      where: { kind: 'verification.submitted', subjectId: garage.fileId },
    });
    expect(events.map((event) => event.payload)).toEqual([
      { fileId: garage.fileId, garageId: garage.garageId },
      {
        fileId: garage.fileId,
        garageId: garage.garageId,
        resubmission: true,
      },
    ]);
  });

  it('writes no row and no entry for an unchanged copy, only the sending again and the copy marked sent', async () => {
    await asked(['photos']);
    const copy = await service.open(garage.owner);
    const rowsOf = async () => ({
      brands: await prisma.garageBrand.findMany({
        where: { garageId: garage.garageId },
      }),
      garage: await prisma.garage.findUniqueOrThrow({
        where: { id: garage.garageId },
      }),
      mechanics: await prisma.mechanic.findMany({
        where: { garageId: garage.garageId },
      }),
      photos: await prisma.garagePhoto.findMany({
        where: { garageId: garage.garageId },
      }),
      prices: await prisma.garagePrice.findMany({
        where: { garageId: garage.garageId },
      }),
    });
    const rows = await rowsOf();
    const since = await clock();

    await send(copy);

    expect(await rowsOf()).toEqual(rows);
    expect(
      (await entriesSince(since)).map(({ kind, subjectType }) => ({
        kind,
        subjectType,
      })),
    ).toEqual([
      { kind: 'verification_resent', subjectType: 'verification_file' },
      { kind: null, subjectType: 'listing_draft' },
    ]);
  });

  it('records each changed field with its old and new value, and each photo and brand added or removed', async () => {
    await asked(['photos']);
    const copy = await service.open(garage.owner);
    const tesla = await prisma.brand.findFirstOrThrow({
      where: { name: 'Tesla' },
    });
    await saved(copy, (data, steps) => ({
      ...data,
      files: [`garage-photos/${randomUUID()}/p9`],
      steps: {
        ...steps,
        '1': { ...steps['1'], phone: '0733 000 111' },
        '2': {
          ...steps['2'],
          brands: [
            ...(steps['2']?.brands ?? []),
            { brandId: tesla.id, name: 'Tesla', stance: 'does_not_take' },
          ],
        },
      },
    }));
    const since = await clock();

    await send(copy);

    const entries = await entriesSince(since);
    expect(entries.filter((e) => e.field === 'phone')).toEqual([
      expect.objectContaining({
        action: 'update',
        newValue: '+40733000111',
        oldValue: '+40722123456',
        subjectType: 'garage',
      }),
    ]);
    expect(
      entries
        .filter((e) => ['garage_photo', 'garage_brand'].includes(e.subjectType))
        .map(({ action, subjectType }) => `${subjectType} ${action}`)
        .sort(),
    ).toEqual([
      'garage_brand create',
      'garage_photo create',
      'garage_photo delete',
    ]);
  });

  it('replaces a document the copy holds and leaves the other one on file', async () => {
    await asked(['documents']);
    const copy = await service.open(garage.owner);
    await saved(copy, (data) => ({
      ...data,
      documents: {
        onrc_certificate: { pages: [`listing-documents/${randomUUID()}/p1`] },
      },
    }));

    await send(copy);

    const rows = await prisma.legalDocument.findMany({
      where: { verificationFileId: garage.fileId },
    });
    const onrc = rows.filter((row) => row.kind === 'onrc_certificate');
    expect(onrc).toHaveLength(2);
    expect(onrc.filter((row) => row.replacedAt === null)).toHaveLength(1);
    expect(rows.filter((row) => row.kind === 'rar_authorisation')).toEqual([
      expect.objectContaining({ replacedAt: null }),
    ]);
    expect(
      await prisma.outboxEvent.count({
        where: {
          kind: 'document.uploaded',
          subjectId: { in: onrc.map((row) => row.id) },
        },
      }),
    ).toBe(2);
  });

  it('logs the sending again without the note', async () => {
    await asked(['photos']);
    const copy = await service.open(garage.owner);
    const logged = jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => undefined);

    try {
      await send(copy);

      const lines = logged.mock.calls.map((call) => String(call[0]));
      expect(lines).toContain(
        `listing resent: draft ${copy.id} file ${garage.fileId} garage ${garage.garageId} account ${garage.owner.accountId}`,
      );
      expect(lines.filter((line) => line.startsWith('listing sent'))).toEqual(
        [],
      );
      expect(lines.some((line) => line.includes(NOTE))).toBe(false);
    } finally {
      logged.mockRestore();
    }
  });

  it('stores the warning when the new CUI is another garage’s', async () => {
    await asked(['other']);
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
    expect(await fileOf()).toMatchObject({ cuiWarning: 'Atelier Vecin' });
    expect(
      await prisma.garage.findUniqueOrThrow({
        where: { id: garage.garageId },
      }),
    ).toMatchObject({ cui: '12345674' });
  });

  it('answers the same result to the same key, sending again once', async () => {
    await asked(['photos']);
    const copy = await service.open(garage.owner);
    const key = randomUUID();

    const first = await send(copy, garage.owner, key);
    const second = await send(copy, garage.owner, key);

    expect(second).toEqual(first);
    expect(
      await prisma.activityLog.count({
        where: { kind: 'verification_resent', subjectId: garage.fileId },
      }),
    ).toBe(1);
  });
});

// @traces 208-FR-008, 208-FR-007
describe('a sending again that is refused', () => {
  async function nothingWritten(copy: CompletionCopyDto, since: Date) {
    expect(await entriesSince(since)).toEqual([]);
    expect(
      await prisma.listingDraft.findUniqueOrThrow({ where: { id: copy.id } }),
    ).toMatchObject({ status: 'open' });
  }

  it.each(['approved', 'rejected', 'in_review'])(
    'answers 409 with the status once the file is %s, and writes nothing',
    async (status) => {
      await asked(['photos']);
      const copy = await service.open(garage.owner);
      await prisma.verificationFile.update({
        data: { status: status as never },
        where: { id: garage.fileId },
      });
      const since = await clock();

      expect(await refusalOf(send(copy))).toMatchObject({
        body: {
          code: 'verification_transition_refused',
          currentStatus: status,
        },
        status: 409,
      });
      await nothingWritten(copy, since);
    },
  );

  it('refuses the staff who are not the owner, and anyone outside the garage', async () => {
    await asked(['photos']);
    const copy = await service.open(garage.owner);
    const since = await clock();

    for (const role of ['mechanic', 'receptionist'] as const) {
      const staff: Actor = { ...garage.owner, role, roles: [role] };
      expect(await refusalOf(send(copy, staff))).toMatchObject({
        body: { code: 'forbidden' },
        status: 403,
      });
    }
    const outsider: Actor = { ...garage.owner, garageId: null, role: 'driver' };
    expect(await refusalOf(send(copy, outsider))).toMatchObject({
      status: 404,
    });
    await nothingWritten(copy, since);
  });

  it('answers 422 with the fields a cleared answer leaves missing, and writes nothing', async () => {
    await asked(['other']);
    const copy = await service.open(garage.owner);
    await saved(copy, (data, steps) => ({
      ...data,
      steps: { ...steps, '1': { ...steps['1'], name: '' } },
    }));
    const since = await clock();

    const refused = await refusalOf(send(copy));

    expect(refused.status).toBe(422);
    expect(refused.body).toMatchObject({ code: 'validation_failed' });
    expect(refused.body['errors']).toContainEqual(
      expect.objectContaining({ field: 'steps.1.name' }),
    );
    expect(await fileOf()).toMatchObject({ status: 'more_requested' });
    await nothingWritten(copy, since);
  });

  it('rolls the whole sending back when one write fails', async () => {
    await asked(['documents']);
    const copy = await service.open(garage.owner);
    await saved(copy, (data, steps) => ({
      ...data,
      documents: {
        onrc_certificate: { pages: [`listing-documents/${randomUUID()}/p1`] },
      },
      steps: { ...steps, '1': { ...steps['1'], phone: '0733 000 111' } },
    }));
    const replace = jest
      .spyOn(LegalDocumentsService.prototype, 'replace')
      .mockRejectedValueOnce(new Error('storage down'));
    const since = await clock();

    try {
      await expect(send(copy)).rejects.toThrow('storage down');
    } finally {
      replace.mockRestore();
    }

    expect(
      await prisma.garage.findUniqueOrThrow({
        where: { id: garage.garageId },
      }),
    ).toMatchObject({ phone: '+40722123456' });
    expect(await fileOf()).toMatchObject({ status: 'more_requested' });
    await nothingWritten(copy, since);
  });
});
