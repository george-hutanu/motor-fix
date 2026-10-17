// @traces 204-FR-015
import { Logger } from '@nestjs/common';

import { VerificationFileController } from './verification-file.controller';
import type { VerificationFileService } from './verification-file.service';
import type { Actor } from '../../../auth/policy';
import type { PrismaClient } from '../../../generated/prisma/client';
import type { VerificationService } from '../verification.service';

const FILE = '6f1c2b9e-3a4d-4e5f-8a7b-1c2d3e4f5a6b';
const ADMIN = { accountId: 'admin-1', role: 'admin' } as unknown as Actor;
const TX = { tx: true };

function controller(correct: jest.Mock) {
  const prisma = {
    $transaction: (work: (tx: unknown) => Promise<unknown>) => work(TX),
  } as unknown as PrismaClient;
  const files = {
    read: jest.fn().mockResolvedValue({ id: FILE }),
  } as unknown as VerificationFileService;
  const verification = {
    correctRarNumber: correct,
  } as unknown as VerificationService;
  return {
    files,
    subject: new VerificationFileController(prisma, files, verification),
  };
}

describe('VerificationFileController.correct', () => {
  afterEach(() => jest.restoreAllMocks());

  it('corrects in one transaction, logs the file and the admin once, and answers the file read', async () => {
    const log = jest.spyOn(Logger.prototype, 'log').mockImplementation();
    const correct = jest.fn().mockResolvedValue(undefined);
    const { files, subject } = controller(correct);

    await expect(
      subject.correct(ADMIN, FILE, { rarNumber: 'RAR-123' }),
    ).resolves.toEqual({ id: FILE });

    expect(correct).toHaveBeenCalledWith(TX, ADMIN, FILE, 'RAR-123');
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0][0]).toContain(FILE);
    expect(log.mock.calls[0][0]).toContain('admin-1');
    expect(files.read).toHaveBeenCalledWith(FILE);
  });

  it('logs nothing when the correction is refused', async () => {
    const log = jest.spyOn(Logger.prototype, 'log').mockImplementation();
    const correct = jest.fn().mockRejectedValue(new Error('refused'));
    const { files, subject } = controller(correct);

    await expect(
      subject.correct(ADMIN, FILE, { rarNumber: 'x' }),
    ).rejects.toThrow('refused');

    expect(log).not.toHaveBeenCalled();
    expect(files.read).not.toHaveBeenCalled();
  });
});
