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
const ago = (ms: number) => new Date(NOW.getTime() - ms);

const sent: string[] = [];
const notifications = {
  sendToDraft: async (_kind: string, draftId: string) => {
    sent.push(draftId);
  },
} as unknown as NotificationsService;

const deleted: unknown[] = [];
const storage = {
  deleteWithCopies: async (key: unknown) => {
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

const exists = async (id: string) =>
  (await prisma.listingDraft.findUnique({ where: { id } })) !== null;

beforeEach(async () => {
  sent.length = 0;
  deleted.length = 0;
  await reset();
});
afterAll(() => prisma.$disconnect());

describe('the reminder at its boundary', () => {
  it('waits for a draft one millisecond short of 3 days', async () => {
    await draft(ago(3 * DAY_MS - 1));

    await sweep.remind(NOW);

    expect(sent).toEqual([]);
  });

  it('skips a draft dated in the future', async () => {
    await draft(new Date(NOW.getTime() + DAY_MS));

    await sweep.remind(NOW);

    expect(sent).toEqual([]);
  });

  it('reminds each of many due drafts exactly once', async () => {
    const ids = [];
    for (let i = 0; i < 25; i++) ids.push((await draft(ago(4 * DAY_MS))).id);

    await sweep.remind(NOW);
    await sweep.remind(NOW);

    expect([...sent].sort()).toEqual([...ids].sort());
  });

  it('sends one reminder when two runs start together', async () => {
    await draft(ago(4 * DAY_MS));

    await Promise.all([sweep.remind(NOW), sweep.remind(NOW)]);

    expect(sent).toHaveLength(1);
  });

  it('does nothing on an empty table', async () => {
    await sweep.run(NOW);

    expect(sent).toEqual([]);
    expect(deleted).toEqual([]);
  });

  it('claims nothing and sends nothing when the public address is not set', async () => {
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    const bare = new ListingDraftSweep(
      prisma,
      notifications,
      storage,
      undefined,
    );
    const due = await draft(ago(4 * DAY_MS));

    await bare.remind(NOW);

    const after = await prisma.listingDraft.findUniqueOrThrow({
      where: { id: due.id },
    });
    expect(after.remindedAt).toBeNull();
    expect(await prisma.listingDraftToken.count()).toBe(0);
    expect(sent).toEqual([]);
    error.mockRestore();
  });

  it('leaves no token and no claim behind when the send fails', async () => {
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    const failing = new ListingDraftSweep(
      prisma,
      {
        sendToDraft: async () => {
          throw new Error('mail down for owner@example.test');
        },
      } as unknown as NotificationsService,
      storage,
      'https://motorfix.test',
    );
    const due = await draft(ago(4 * DAY_MS));

    await failing.remind(NOW);

    const after = await prisma.listingDraft.findUniqueOrThrow({
      where: { id: due.id },
    });
    expect(after.remindedAt).toBeNull();
    expect(await prisma.listingDraftToken.count()).toBe(0);
    const logged = error.mock.calls.map((c) => String(c[0])).join('\n');
    expect(logged).not.toContain('owner@example.test');
    error.mockRestore();
  });
});

describe('the clean-up at its boundary', () => {
  it('keeps a draft one millisecond short of 90 days and deletes one at exactly 90', async () => {
    const young = await draft(ago(90 * DAY_MS - 1));
    const old = await draft(ago(90 * DAY_MS));

    await sweep.cleanUp(NOW);

    expect(await exists(young.id)).toBe(true);
    expect(await exists(old.id)).toBe(false);
  });

  it('keeps a sent draft of any age and deletes none of its files', async () => {
    const sentDraft = await draft(ago(400 * DAY_MS), {
      data: { files: ['listing/kept.jpg'] },
      status: 'submitted',
    });

    await sweep.cleanUp(NOW);

    expect(await exists(sentDraft.id)).toBe(true);
    expect(deleted).toEqual([]);
  });

  it.each([
    ['text', 'listing/a.jpg'],
    ['null', null],
    ['an object', { a: 1 }],
    ['a number', 7],
  ])(
    'deletes a draft whose files field is %s without touching storage',
    async (_t, files) => {
      const old = await draft(ago(100 * DAY_MS), { data: { files } });

      await sweep.cleanUp(NOW);

      expect(deleted).toEqual([]);
      expect(await exists(old.id)).toBe(false);
    },
  );

  it('asks storage only for text keys when the list holds other things', async () => {
    await draft(ago(100 * DAY_MS), {
      data: { files: ['listing/a.jpg', null, 7, { k: 1 }] },
    });

    await sweep.cleanUp(NOW);

    expect(deleted).toEqual(['listing/a.jpg']);
  });

  it('deletes a draft that holds no data at all', async () => {
    const old = await draft(ago(100 * DAY_MS), { data: {} });

    await sweep.cleanUp(NOW);

    expect(await exists(old.id)).toBe(false);
  });

  it('removes the notification rows of a deleted draft', async () => {
    const old = await draft(ago(100 * DAY_MS));
    await prisma.listingDraftToken.create({
      data: {
        draftId: old.id,
        hash: 'h',
        kind: 'link',
        sentAt: ago(DAY_MS),
      },
    });

    await sweep.cleanUp(NOW);

    expect(await prisma.listingDraftToken.count()).toBe(0);
  });
});
