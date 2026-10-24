// @traces 140-FR-006 140-FR-016
import { countedMetrics, counterTotal } from '@motor-fix/observability/testing';
import { Logger } from '@nestjs/common';

import { DataExportBuilder } from './data-export.builder';
import type { EventPort } from '../../events/event.port';
import type { PrismaClient } from '../../generated/prisma/client';
import type { NotificationsService } from '../../notifications/notifications.service';
import type { StorageService } from '../../storage/storage.service';

const ID = '7d1f8a52-3c9b-4e1a-9f0d-2b6c4e8a1f37';
const ACCOUNT = 'c2a4e6b8-1d3f-4a5c-8e7b-9f0a1b2c3d4e';
const KEY = `data-exports/${ACCOUNT}/${ID}.zip`;

const reader = countedMetrics();
const failedTotal = () =>
  counterTotal(reader, 'motorfix_data_exports_total', { outcome: 'failed' });

// The builder over stand-ins: the row starts `status`, and each write to it
// moves it as the database would.
function setup(status: 'queued' | 'ready') {
  const row = { status: status as string };
  const updateMany = jest.fn(
    async ({
      data,
      where,
    }: {
      data: { status: string };
      where: { status: string };
    }) => {
      if (row.status !== where.status) return { count: 0 };
      row.status = data.status;
      return { count: 1 };
    },
  );
  const prisma = {
    $transaction: jest.fn(async (work: (tx: unknown) => unknown) =>
      work({ dataExport: { updateMany } }),
    ),
    dataExport: {
      findUnique: jest.fn(async () => ({
        account: {
          email: 'ana@example.test',
          language: 'ro',
          status: 'active',
        },
        accountId: ACCOUNT,
        requestedAt: new Date('2026-10-01T10:00:00Z'),
        status: row.status,
      })),
      update: jest.fn(async () => ({})),
      updateMany,
    },
  };
  const storage = {
    deleteObject: jest.fn(async () => undefined),
    putObject: jest.fn(async () => undefined),
  };
  const notifications = { notify: jest.fn(async () => 1) };
  const events = { record: jest.fn(async () => undefined) };
  const builder = new DataExportBuilder(
    prisma as unknown as PrismaClient,
    events as unknown as EventPort,
    'https://motorfix.test',
    notifications as unknown as NotificationsService,
    storage as unknown as StorageService,
  );
  jest
    .spyOn(
      builder as unknown as {
        collect: () => Promise<{ data: string; name: string }[]>;
      },
      'collect',
    )
    .mockResolvedValue([{ data: 'x', name: 'README.txt' }]);
  const run = (attemptsMade: number) =>
    builder.onEvent({
      attemptsMade,
      data: {
        id: ID,
        kind: 'data_export.requested',
        payload: { exportId: ID },
      },
    });
  return { events, notifications, prisma, row, run, storage };
}

beforeEach(() => {
  jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

describe('DataExportBuilder, a try that fails after the file is stored', () => {
  it('deletes the stored file when the last try fails to mark it ready', async () => {
    const world = setup('queued');
    world.prisma.$transaction.mockRejectedValue(new Error('lost connection'));
    const before = await failedTotal();

    await expect(world.run(2)).rejects.toThrow('lost connection');

    expect(world.storage.putObject).toHaveBeenCalledWith(
      KEY,
      expect.anything(),
      'application/zip',
    );
    expect(world.storage.deleteObject).toHaveBeenCalledWith(KEY);
    expect(world.row.status).toBe('failed');
    expect((await failedTotal()) - before).toBe(1);
  });

  it('keeps the file for a try that is not the last', async () => {
    const world = setup('queued');
    world.prisma.$transaction.mockRejectedValue(new Error('lost connection'));

    await expect(world.run(0)).rejects.toThrow('lost connection');

    expect(world.storage.deleteObject).not.toHaveBeenCalled();
    expect(world.row.status).toBe('queued');
  });

  it('marks it failed without a delete when the store refused the file', async () => {
    const world = setup('queued');
    world.storage.putObject.mockRejectedValue(new Error('store down'));

    await expect(world.run(2)).rejects.toThrow('store down');

    expect(world.storage.deleteObject).not.toHaveBeenCalled();
    expect(world.row.status).toBe('failed');
  });
});

describe('DataExportBuilder, a ready e-mail that fails', () => {
  it('keeps the export ready and its file, and counts no failure', async () => {
    const world = setup('queued');
    world.notifications.notify.mockRejectedValue(new Error('smtp down'));
    const before = await failedTotal();

    await expect(world.run(2)).rejects.toThrow('smtp down');

    expect(world.row.status).toBe('ready');
    expect(world.storage.deleteObject).not.toHaveBeenCalled();
    expect((await failedTotal()) - before).toBe(0);
  });

  it('sends the e-mail on the next try, without building again', async () => {
    const world = setup('queued');
    world.notifications.notify.mockRejectedValueOnce(new Error('smtp down'));

    await expect(world.run(0)).rejects.toThrow('smtp down');
    await world.run(1);

    expect(world.notifications.notify).toHaveBeenCalledTimes(2);
    expect(world.storage.putObject).toHaveBeenCalledTimes(1);
    expect(world.row.status).toBe('ready');
  });
});
