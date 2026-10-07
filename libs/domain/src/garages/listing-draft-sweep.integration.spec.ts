import { Logger } from '@nestjs/common';

import { ListingDraftSweep } from './listing-draft-sweep';
import { serialDatabase } from '../auth/serial-db.testing';
import type { NotificationsService } from '../notifications/notifications.service';
import { databaseUrl, fixtures } from '../notifications/notifications.testing';
import type { StorageService } from '../storage/storage.service';

const { prisma, reset } = fixtures();
serialDatabase(databaseUrl);

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-10-07T06:00:00Z');
const daysAgo = (days: number) => new Date(NOW.getTime() - days * DAY_MS);

const sent: { kind: string; draftId: string; link: string }[] = [];
let failFor: string | undefined;
const notifications = {
  sendToDraft: async (kind: string, draftId: string, link: string) => {
    if (draftId === failFor) throw new Error('mail down');
    sent.push({ draftId, kind, link });
  },
} as unknown as NotificationsService;

const deleted: string[] = [];
const storage = {
  deleteObject: async (key: string) => {
    deleted.push(key);
  },
} as unknown as StorageService;

const sweep = new ListingDraftSweep(
  prisma,
  notifications,
  storage,
  'https://motorfix.test',
);

const draft = (updatedAt: Date, overrides: Record<string, unknown> = {}) =>
  prisma.listingDraft.create({
    data: {
      data: {},
      email: 'owner@example.test',
      language: 'ro',
      step: 2,
      updatedAt,
      ...overrides,
    },
  });

beforeEach(async () => {
  sent.length = 0;
  deleted.length = 0;
  failFor = undefined;
  await reset();
});
afterAll(() => prisma.$disconnect());

describe('the reminder', () => {
  it('goes once to an open draft untouched for 3 days, with a reminder key', async () => {
    const due = await draft(daysAgo(3));

    await sweep.remind(NOW);

    expect(sent).toEqual([
      {
        draftId: due.id,
        kind: 'LISTING_REMINDER',
        link: expect.stringMatching(
          /^https:\/\/motorfix\.test\/ro\/list-your-garage\?draft=[\w-]{43}$/,
        ),
      },
    ]);
    const tokens = await prisma.listingDraftToken.findMany({
      where: { draftId: due.id },
    });
    expect(tokens.map((t) => t.kind)).toEqual(['reminder']);
    const after = await prisma.listingDraft.findUniqueOrThrow({
      where: { id: due.id },
    });
    expect(after.remindedAt).toEqual(NOW);
    expect(after.updatedAt).toEqual(due.updatedAt);
  });

  it('skips a reminded, a sent and a recently changed draft', async () => {
    await draft(daysAgo(5), { remindedAt: daysAgo(1) });
    await draft(daysAgo(5), { status: 'submitted' });
    await draft(daysAgo(2));

    await sweep.remind(NOW);

    expect(sent).toEqual([]);
  });

  it('sends nothing twice when it runs again the same day', async () => {
    await draft(daysAgo(4));

    await sweep.remind(NOW);
    await sweep.remind(NOW);

    expect(sent).toHaveLength(1);
  });

  it('logs a failed draft by its id alone, reminds the others and tries it again next run', async () => {
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    const broken = await draft(daysAgo(4), { email: 'broken@example.test' });
    const fine = await draft(daysAgo(4));
    failFor = broken.id;

    await sweep.remind(NOW);

    expect(sent.map((s) => s.draftId)).toEqual([fine.id]);
    const logged = error.mock.calls.map((c) => String(c[0])).join('\n');
    expect(logged).toContain(broken.id);
    expect(logged).not.toContain('broken@example.test');

    failFor = undefined;
    await sweep.remind(NOW);
    expect(sent.map((s) => s.draftId)).toEqual([fine.id, broken.id]);
    error.mockRestore();
  });
});

describe('the clean-up', () => {
  it('deletes an open draft 90 days old with its files and keys', async () => {
    const old = await draft(daysAgo(90), {
      data: { files: ['listing/a.jpg', 'listing/b.jpg'] },
    });
    await prisma.listingDraftToken.create({
      data: { draftId: old.id, hash: 'h1', kind: 'link', sentAt: daysAgo(90) },
    });

    await sweep.cleanUp(NOW);

    expect(deleted).toEqual(['listing/a.jpg', 'listing/b.jpg']);
    await expect(
      prisma.listingDraft.findUnique({ where: { id: old.id } }),
    ).resolves.toBeNull();
    await expect(
      prisma.listingDraftToken.count({ where: { draftId: old.id } }),
    ).resolves.toBe(0);
  });

  it('keeps a draft changed since and a sent one', async () => {
    const changed = await draft(daysAgo(89));
    const submitted = await draft(daysAgo(120), { status: 'submitted' });

    await sweep.cleanUp(NOW);

    await expect(
      prisma.listingDraft.count({
        where: { id: { in: [changed.id, submitted.id] } },
      }),
    ).resolves.toBe(2);
  });

  it('keeps the draft whose files could not be deleted, and deletes the others', async () => {
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    const stuck = await draft(daysAgo(91), {
      data: { files: ['listing/x.jpg'] },
    });
    const gone = await draft(daysAgo(91));
    const failing = {
      deleteObject: async () => {
        throw new Error('bucket down');
      },
    } as unknown as StorageService;

    await new ListingDraftSweep(
      prisma,
      notifications,
      failing,
      'https://motorfix.test',
    ).cleanUp(NOW);

    const left = await prisma.listingDraft.findMany({ select: { id: true } });
    expect(left.map((d) => d.id)).toEqual([stuck.id]);
    expect(gone.id).not.toBe(stuck.id);
    expect(String(error.mock.calls[0]?.[0])).toContain(stuck.id);
    error.mockRestore();
  });
});

describe('the daily run', () => {
  it('deletes the expired drafts before it reminds the rest', async () => {
    const due = await draft(daysAgo(3));
    const old = await draft(daysAgo(90));

    await sweep.run(NOW);

    expect(sent.map((s) => s.draftId)).toEqual([due.id]);
    await expect(
      prisma.listingDraft.findUnique({ where: { id: old.id } }),
    ).resolves.toBeNull();
  });
});
