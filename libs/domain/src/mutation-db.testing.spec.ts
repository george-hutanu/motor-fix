// @traces 1338-FR-009
import { workerUrls } from './mutation-db.testing';

const DATABASE_URL =
  'postgresql://motorfix:secret@db:5432/motorfix?schema=public';

describe('the test database of a mutation worker', () => {
  it('gives worker 3 its own PostgreSQL database and Redis index', () => {
    expect(
      workerUrls({
        DATABASE_URL,
        REDIS_URL: 'redis://cache:6379',
        STRYKER_MUTATOR_WORKER: '3',
      }),
    ).toEqual({
      DATABASE_URL:
        'postgresql://motorfix:secret@db:5432/postgres_w3?schema=public',
      REDIS_URL: 'redis://cache:6379/3',
    });
  });

  it('replaces a Redis index the URL already names', () => {
    expect(
      workerUrls({
        DATABASE_URL,
        REDIS_URL: 'redis://cache:6379/0',
        STRYKER_MUTATOR_WORKER: '0',
      }).REDIS_URL,
    ).toBe('redis://cache:6379/0');
    expect(
      workerUrls({
        DATABASE_URL,
        REDIS_URL: 'redis://cache:6379/0',
        STRYKER_MUTATOR_WORKER: '12',
      }).REDIS_URL,
    ).toBe('redis://cache:6379/12');
  });

  it('gives two workers two different databases', () => {
    const one = workerUrls({ DATABASE_URL, STRYKER_MUTATOR_WORKER: '1' });
    const two = workerUrls({ DATABASE_URL, STRYKER_MUTATOR_WORKER: '2' });

    expect(one.DATABASE_URL).not.toBe(two.DATABASE_URL);
  });

  it('leaves the URLs alone outside a mutation run', () => {
    expect(
      workerUrls({ DATABASE_URL, REDIS_URL: 'redis://cache:6379/1' }),
    ).toEqual({ DATABASE_URL, REDIS_URL: 'redis://cache:6379/1' });
  });

  it.each(['-1', 'x', '1.5', ''])(
    'refuses a worker id %j that is not a whole number',
    (id) => {
      expect(() =>
        workerUrls({ DATABASE_URL, STRYKER_MUTATOR_WORKER: id }),
      ).toThrow('STRYKER_MUTATOR_WORKER');
    },
  );
});
