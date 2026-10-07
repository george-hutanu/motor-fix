import { S3TestStore } from '@motor-fix/domain/testing';
import { NestApplication } from '@nestjs/core';
import { Test } from '@nestjs/testing';

import { apiBoot } from './api-boot.testing';
import { expectTurnFree } from './turn-probe.testing';

const databaseUrl =
  process.env['DATABASE_URL'] ?? 'postgresql://localhost:5432/postgres';

afterEach(() => {
  jest.restoreAllMocks();
});

describe('stopping the API boot handle in unusual orders', () => {
  it('stops cleanly when start was never called, closing nothing', async () => {
    const closeApp = jest.spyOn(NestApplication.prototype, 'close');
    const stopStore = jest.spyOn(S3TestStore.prototype, 'stop');
    const api = apiBoot();

    await expect(api.stop()).resolves.toBeUndefined();

    expect(closeApp).not.toHaveBeenCalled();
    expect(stopStore).not.toHaveBeenCalled();
    await expectTurnFree(databaseUrl);
  }, 240_000);

  it('rethrows the app error and still stops the store when both closes fail', async () => {
    const appFailure = new Error('app close failed');
    const storeFailure = new Error('store stop failed');
    const closeOriginal = NestApplication.prototype.close;
    const stopOriginal = S3TestStore.prototype.stop;
    jest
      .spyOn(NestApplication.prototype, 'close')
      .mockImplementationOnce(async function (this: NestApplication) {
        await closeOriginal.call(this);
        throw appFailure;
      });
    const stopStore = jest
      .spyOn(S3TestStore.prototype, 'stop')
      .mockImplementationOnce(async function (this: S3TestStore) {
        await stopOriginal.call(this);
        throw storeFailure;
      });
    const api = apiBoot();
    await api.start();

    await expect(api.stop()).rejects.toBe(appFailure);

    expect(stopStore).toHaveBeenCalledTimes(1);
    await expectTurnFree(databaseUrl);
  }, 240_000);

  it('rethrows the store error and gives the turn back when only the store fails to stop', async () => {
    const storeFailure = new Error('store stop failed');
    const stopOriginal = S3TestStore.prototype.stop;
    const closeApp = jest.spyOn(NestApplication.prototype, 'close');
    jest
      .spyOn(S3TestStore.prototype, 'stop')
      .mockImplementationOnce(async function (this: S3TestStore) {
        await stopOriginal.call(this);
        throw storeFailure;
      });
    const api = apiBoot();
    await api.start();

    await expect(api.stop()).rejects.toBe(storeFailure);

    expect(closeApp).toHaveBeenCalledTimes(1);
    await expectTurnFree(databaseUrl);
  }, 240_000);

  it('does nothing further on a second stop after a stop that threw', async () => {
    const failure = new Error('close failed');
    const closeOriginal = NestApplication.prototype.close;
    const closeApp = jest
      .spyOn(NestApplication.prototype, 'close')
      .mockImplementationOnce(async function (this: NestApplication) {
        await closeOriginal.call(this);
        throw failure;
      });
    const stopStore = jest.spyOn(S3TestStore.prototype, 'stop');
    const api = apiBoot();
    await api.start();
    await expect(api.stop()).rejects.toBe(failure);

    await expect(api.stop()).resolves.toBeUndefined();

    expect(closeApp).toHaveBeenCalledTimes(1);
    expect(stopStore).toHaveBeenCalledTimes(1);
    await expectTurnFree(databaseUrl);
  }, 240_000);

  it('stays harmless when stop is called twice after a failed boot', async () => {
    const failure = new Error('bad module');
    jest.spyOn(Test, 'createTestingModule').mockImplementationOnce(() => {
      throw failure;
    });
    const stopStore = jest.spyOn(S3TestStore.prototype, 'stop');
    const api = apiBoot();
    await expect(api.start()).rejects.toBe(failure);

    await api.stop();
    await expect(api.stop()).resolves.toBeUndefined();

    expect(stopStore).toHaveBeenCalledTimes(1);
    await expectTurnFree(databaseUrl);
  }, 240_000);

  it('releases the turn when the failed boot left a close that also throws', async () => {
    const initFailure = new Error('init failed');
    const closeFailure = new Error('close failed');
    const closeOriginal = NestApplication.prototype.close;
    jest
      .spyOn(NestApplication.prototype, 'init')
      .mockRejectedValueOnce(initFailure);
    jest
      .spyOn(NestApplication.prototype, 'close')
      .mockImplementationOnce(async function (this: NestApplication) {
        await closeOriginal.call(this);
        throw closeFailure;
      });
    const stopStore = jest.spyOn(S3TestStore.prototype, 'stop');
    const api = apiBoot();
    await expect(api.start()).rejects.toBe(initFailure);

    await expect(api.stop()).rejects.toBe(closeFailure);

    expect(stopStore).toHaveBeenCalledTimes(1);
    await expectTurnFree(databaseUrl);
  }, 240_000);
});
