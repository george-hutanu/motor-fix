import { Logger } from '@nestjs/common';

import { ListingDraftSweep } from './listing-draft-sweep';
import { AuditService } from '../audit/audit.service';
import { serialDatabase } from '../auth/serial-db.testing';
import { NotificationsService } from '../notifications/notifications.service';
import {
  databaseUrl,
  fixtures,
  testConfig,
} from '../notifications/notifications.testing';
import type { StorageService } from '../storage/storage.service';

const { prisma, reset } = fixtures();
serialDatabase(databaseUrl);

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-10-07T06:00:00Z');
const daysAgo = (days: number) => new Date(NOW.getTime() - days * DAY_MS);

let refusals = 0;
const queued: unknown[] = [];
const jobs = {
  add: async (_name: string, data: unknown) => {
    if (refusals > 0) {
      refusals -= 1;
      throw new Error('queue down');
    }
    queued.push(data);
  },
};
const real = new NotificationsService(
  prisma,
  jobs as never,
  { publish: async () => 0 } as never,
  testConfig('http://localhost:9'),
  null,
  new AuditService(),
);
real.now = () => NOW;
const sweep = new ListingDraftSweep(
  prisma,
  real,
  { deleteWithCopies: async () => undefined } as unknown as StorageService,
  'https://motorfix.test',
);

const draft = (updatedAt: Date) =>
  prisma.listingDraft.create({
    data: {
      data: {},
      email: 'owner@example.test',
      language: 'ro',
      step: 2,
      updatedAt,
    },
  });
const rows = (draftId: string) =>
  prisma.notification.findMany({
    orderBy: { createdAt: 'asc' },
    where: { listingDraftId: draftId },
  });

beforeEach(async () => {
  refusals = 0;
  queued.length = 0;
  await reset();
  jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());
afterAll(() => prisma.$disconnect());

// @traces 116-FR-036
describe('the reminder when the queue fails once', () => {
  it('holds one notification row for the reminder after the next sweep, queued and sent', async () => {
    const due = await draft(daysAgo(3));
    refusals = 1;

    await sweep.remind(NOW);
    await sweep.remind(new Date(NOW.getTime() + DAY_MS));

    const written = await rows(due.id);
    expect(written.map((row) => row.status)).toEqual(['queued']);
    expect(queued).toHaveLength(1);
  });

  it('leaves no row queued that no job carries once the next sweep has run, whichever of many drafts the queue refused', async () => {
    const ids = [
      (await draft(daysAgo(3))).id,
      (await draft(daysAgo(4))).id,
      (await draft(daysAgo(5))).id,
    ];
    refusals = 2;

    await sweep.remind(NOW);
    await sweep.remind(new Date(NOW.getTime() + DAY_MS));

    const all = (await Promise.all(ids.map(rows))).flat();
    const queuedRows = all.filter((row) => row.status === 'queued');
    expect(queuedRows.map((row) => row.id).sort()).toEqual(
      (queued as { id: string }[]).map((job) => job.id).sort(),
    );
  });

  it('sends exactly one reminder per draft over three days of sweeps with the queue down for the first two runs', async () => {
    const due = await draft(daysAgo(3));
    refusals = 2;

    for (let day = 0; day < 4; day++) {
      await sweep.remind(new Date(NOW.getTime() + day * DAY_MS));
    }

    expect(queued).toHaveLength(1);
    expect(
      (await rows(due.id)).filter((r) => r.status === 'queued'),
    ).toHaveLength(1);
  });
});
