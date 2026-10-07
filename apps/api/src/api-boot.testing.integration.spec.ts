import { databaseTurn, S3TestStore } from '@motor-fix/domain/testing';
import { NestApplication } from '@nestjs/core';
import { Test } from '@nestjs/testing';

import { apiBoot } from './api-boot.testing';

const databaseUrl =
  process.env['DATABASE_URL'] ?? 'postgresql://localhost:5432/postgres';

// A turn the handle kept would never come back; another file holding it
// gives it back well within this window.
async function expectTurnFree() {
  const probe = databaseTurn(databaseUrl);
  let timer: NodeJS.Timeout | undefined;
  const leaked = new Promise<'leaked'>((resolve) => {
    timer = setTimeout(() => resolve('leaked'), 60_000);
  });
  try {
    await expect(
      Promise.race([probe.take().then(() => 'free' as const), leaked]),
    ).resolves.toBe('free');
  } finally {
    clearTimeout(timer);
    await probe.release();
  }
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe('stopping the API boot handle', () => {
  it('gives the turn back when the store fails to start', async () => {
    const failure = new Error('store down');
    jest.spyOn(S3TestStore.prototype, 'start').mockRejectedValueOnce(failure);
    const stopStore = jest.spyOn(S3TestStore.prototype, 'stop');
    const api = apiBoot();

    await expect(api.start()).rejects.toBe(failure);
    await api.stop();

    expect(stopStore).not.toHaveBeenCalled();
    await expectTurnFree();
  }, 120_000);

  it('stops the store and gives the turn back when the module fails to compile', async () => {
    const failure = new Error('bad module');
    jest.spyOn(Test, 'createTestingModule').mockImplementationOnce(() => {
      throw failure;
    });
    const stopStore = jest.spyOn(S3TestStore.prototype, 'stop');
    const api = apiBoot();

    await expect(api.start()).rejects.toBe(failure);
    await api.stop();

    expect(stopStore).toHaveBeenCalledTimes(1);
    await expectTurnFree();
  }, 120_000);

  it('closes the app that failed to start, then the store, then the turn', async () => {
    const failure = new Error('init failed');
    jest
      .spyOn(NestApplication.prototype, 'init')
      .mockRejectedValueOnce(failure);
    const closeApp = jest.spyOn(NestApplication.prototype, 'close');
    const stopStore = jest.spyOn(S3TestStore.prototype, 'stop');
    const api = apiBoot();

    await expect(api.start()).rejects.toBe(failure);
    await api.stop();

    expect(closeApp).toHaveBeenCalledTimes(1);
    expect(stopStore).toHaveBeenCalledTimes(1);
    await expectTurnFree();
  }, 120_000);

  it('still stops the store and gives the turn back when the app fails to close, then rethrows', async () => {
    const failure = new Error('close failed');
    const close = NestApplication.prototype.close;
    jest
      .spyOn(NestApplication.prototype, 'close')
      .mockImplementationOnce(async function (this: NestApplication) {
        await close.call(this);
        throw failure;
      });
    const stopStore = jest.spyOn(S3TestStore.prototype, 'stop');
    const api = apiBoot();
    await api.start();

    await expect(api.stop()).rejects.toBe(failure);

    expect(stopStore).toHaveBeenCalledTimes(1);
    await expectTurnFree();
  }, 120_000);

  it('closes a started app before its store, and a second stop does nothing', async () => {
    const closeApp = jest.spyOn(NestApplication.prototype, 'close');
    const stopStore = jest.spyOn(S3TestStore.prototype, 'stop');
    const api = apiBoot();
    const app = await api.start();
    expect(app.getHttpServer()).toBeDefined();

    await api.stop();
    await api.stop();

    expect(closeApp).toHaveBeenCalledTimes(1);
    expect(stopStore).toHaveBeenCalledTimes(1);
    expect(closeApp.mock.invocationCallOrder[0]).toBeLessThan(
      stopStore.mock.invocationCallOrder[0] ?? 0,
    );
    await expectTurnFree();
  }, 120_000);
});
