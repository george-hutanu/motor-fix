import { randomUUID } from 'node:crypto';

import { serialDatabase } from '../auth/serial-db.testing';
import { databaseUrl, fixtures } from '../notifications/notifications.testing';

const { account, prisma, reset } = fixtures();
serialDatabase(databaseUrl);

beforeEach(() => reset());
afterAll(() => prisma.$disconnect());

const draft = (overrides: Record<string, unknown> = {}) =>
  prisma.listingDraft.create({
    data: {
      email: 'owner@example.test',
      language: 'ro',
      step: 1,
      updatedAt: new Date('2026-10-07T10:00:00Z'),
      ...overrides,
    },
  });

const draftEmail = (listingDraftId: string, eventId: string = randomUUID()) =>
  prisma.notification.create({
    data: {
      channel: 'email',
      eventId,
      kind: 'LISTING_CONTINUE_LINK',
      listingDraftId,
      status: 'queued',
    },
  });

describe('a saved listing draft', () => {
  it('starts open, with empty data and no reminder', async () => {
    const saved = await draft();

    expect(saved).toMatchObject({
      data: {},
      remindedAt: null,
      status: 'open',
      step: 1,
    });
    expect(saved.createdAt).toBeInstanceOf(Date);
    expect(saved.updatedAt.toISOString()).toBe('2026-10-07T10:00:00.000Z');
  });

  it.each([0, 7])('refuses step %i', async (step) => {
    await expect(draft({ step })).rejects.toThrow();
  });

  it('refuses a draft without an e-mail', async () => {
    await expect(
      prisma.$executeRaw`INSERT INTO listing_draft (id, email, language, step, updated_at) VALUES (${randomUUID()}::uuid, NULL, 'ro', 1, now())`,
    ).rejects.toThrow();
  });

  it('keeps a token by its hash and loses it with the draft', async () => {
    const saved = await draft();
    const token = await prisma.listingDraftToken.create({
      data: { draftId: saved.id, hash: 'a'.repeat(64), sentAt: new Date() },
    });
    expect(token.reminder).toBe(false);

    await prisma.listingDraft.delete({ where: { id: saved.id } });

    expect(await prisma.listingDraftToken.count()).toBe(0);
  });
});

describe('an e-mail to a draft', () => {
  it('has no account and goes with the draft', async () => {
    const saved = await draft();
    const row = await draftEmail(saved.id);
    expect(row.accountId).toBeNull();

    await prisma.listingDraft.delete({ where: { id: saved.id } });

    expect(await prisma.notification.count()).toBe(0);
  });

  it('is written once per event', async () => {
    const saved = await draft();
    await draftEmail(saved.id, 'evt-1');

    await expect(draftEmail(saved.id, 'evt-1')).rejects.toThrow();
  });

  it('refuses a row with both an account and a draft, or with neither', async () => {
    const saved = await draft();
    const ana = await account('ana');
    const row = {
      channel: 'email' as const,
      eventId: randomUUID(),
      kind: 'LISTING_CONTINUE_LINK',
      status: 'queued' as const,
    };

    await expect(
      prisma.notification.create({
        data: { ...row, accountId: ana, listingDraftId: saved.id },
      }),
    ).rejects.toThrow();
    await expect(prisma.notification.create({ data: row })).rejects.toThrow();
  });
});
