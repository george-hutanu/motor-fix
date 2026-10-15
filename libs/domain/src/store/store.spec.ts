import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

import { Redis } from 'ioredis';

import { borrowStore, returnStore } from './store';

jest.mock('ioredis', () => ({
  Redis: jest.fn().mockImplementation(() => ({
    disconnect: jest.fn(),
    on: jest.fn(),
    quit: jest.fn().mockResolvedValue('OK'),
    status: 'ready',
  })),
}));

const constructed = Redis as unknown as jest.Mock;

describe('the store connection', () => {
  beforeEach(() => constructed.mockClear());

  // @traces 1175-FR-007
  it('opens one pipelined command connection per address, whoever asks', async () => {
    const first = borrowStore('redis://store:6379');
    const second = borrowStore('redis://store:6379');

    expect(second).toBe(first);
    expect(constructed).toHaveBeenCalledTimes(1);
    expect(constructed).toHaveBeenCalledWith('redis://store:6379', {
      commandTimeout: 2000,
      connectTimeout: 2000,
      enableAutoPipelining: true,
      lazyConnect: true,
      maxRetriesPerRequest: 1,
    });
    await returnStore(first);
    await returnStore(second);
  });

  // @traces 1175-FR-007
  it('closes the connection only when the last borrower gives it back', async () => {
    const first = borrowStore('redis://store:6379/1');
    const second = borrowStore('redis://store:6379/1');

    await returnStore(first);
    expect(first.quit).not.toHaveBeenCalled();
    await returnStore(second);
    expect(first.quit).toHaveBeenCalledTimes(1);

    expect(borrowStore('redis://store:6379/1')).not.toBe(first);
    expect(constructed).toHaveBeenCalledTimes(2);
  });

  // @traces 1175-FR-007
  it('drops a connection that is not ready instead of waiting to quit it', async () => {
    const redis = borrowStore('redis://down:6379');
    Object.assign(redis, { status: 'reconnecting' });

    await returnStore(redis);

    expect(redis.disconnect).toHaveBeenCalledTimes(1);
    expect(redis.quit).not.toHaveBeenCalled();
  });

  // @traces 1175-FR-007
  it('gives a separate connection to a different address', async () => {
    const one = borrowStore('redis://store:6379/2');
    const other = borrowStore('redis://store:6379/3');

    expect(other).not.toBe(one);
    await returnStore(one);
    await returnStore(other);
  });
});

// @traces 1175-FR-007 1175-FR-009
describe('the connections the product code opens', () => {
  const src = join(__dirname, '..');
  const source = (name: string) =>
    /\.ts$/.test(name) && !/\.(spec|testing)\.ts$/.test(name);
  const files = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const path = join(dir, entry.name);
      if (!entry.isDirectory()) return source(entry.name) ? [path] : [];
      return entry.name === 'generated' ? [] : files(path);
    });

  it('are the store connection and the live subscriber only', () => {
    const opening = files(src)
      .filter((path) => /new Redis\(/.test(readFileSync(path, 'utf8')))
      .map((path) => relative(src, path))
      .sort();

    expect(opening).toEqual(['events/events.module.ts', 'store/store.ts']);
  });
});
