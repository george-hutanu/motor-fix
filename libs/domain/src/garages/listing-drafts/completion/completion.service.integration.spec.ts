import { HttpException, Logger } from '@nestjs/common';

import { copyOf } from './completion.copy';
import { CompletionService } from './completion.service';
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

const { account, prisma } = fixtures();
serialDatabase(databaseUrl);
const { drafts, listed, plain, reset } = completionWorld(prisma);
const service = new CompletionService(prisma);

let garage: Listed;

async function asked(items: string[], status = 'more_requested') {
  await prisma.verificationFile.update({
    data: { requestedItems: items, status: status as never },
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
