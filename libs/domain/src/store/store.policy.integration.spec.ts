import { Redis } from 'ioredis';

const url = process.env['REDIS_URL'] ?? 'redis://localhost:6379';
const redis = new Redis(url);

afterAll(() => redis.disconnect());

// @traces 1175-FR-003
describe('the store', () => {
  it('runs without eviction', async () => {
    const reply = await redis
      .config('GET', 'maxmemory-policy')
      .catch((error: Error) => {
        throw new Error(
          `the store at ${new URL(url).host} refused CONFIG GET: ${error.message}`,
        );
      });

    expect(reply).toEqual(['maxmemory-policy', 'noeviction']);
  });

  // @traces 1175-FR-001 1175-FR-010
  it('is Valkey 9', async () => {
    expect(await redis.info('server')).toMatch(/^valkey_version:9\./m);
  });
});
