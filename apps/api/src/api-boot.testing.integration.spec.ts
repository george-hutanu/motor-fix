import { databaseTurn, S3TestStore } from '@motor-fix/domain/testing';
import { NestApplication } from '@nestjs/core';
import { Test } from '@nestjs/testing';

import { apiBoot } from './api-boot.testing';
import { expectTurnFree } from './turn-probe.testing';

const databaseUrl =
  process.env['DATABASE_URL'] ?? 'postgresql://localhost:5432/postgres';

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
    await expectTurnFree(databaseUrl);
  }, 240_000);

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
    await expectTurnFree(databaseUrl);
  }, 240_000);

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
    await expectTurnFree(databaseUrl);
  }, 240_000);

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
    await expectTurnFree(databaseUrl);
  }, 240_000);

  it('gives everything back when stopped while start still waits for the turn', async () => {
    const holder = databaseTurn(databaseUrl);
    await holder.take();
    const startStore = jest.spyOn(S3TestStore.prototype, 'start');
    const api = apiBoot();
    const starting = api.start().then(
      () => 'started',
      () => 'abandoned',
    );

    const stopping = api.stop();
    await holder.release();
    await stopping;

    await expect(starting).resolves.toBe('abandoned');
    expect(startStore).not.toHaveBeenCalled();
    await expectTurnFree(databaseUrl);
  }, 240_000);

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
    await expectTurnFree(databaseUrl);
  }, 240_000);
});
