import { BrandLoader } from './brand-loader';

// @traces 105-FR-013
describe('the brand loader transaction timeout', () => {
  const saved = process.env['BRAND_LOAD_TIMEOUT_MS'];
  afterEach(() => {
    if (saved === undefined) delete process.env['BRAND_LOAD_TIMEOUT_MS'];
    else process.env['BRAND_LOAD_TIMEOUT_MS'] = saved;
  });

  const timeoutUsed = async () => {
    const options: unknown[] = [];
    const prisma = {
      $transaction: vi.fn(async (_fn: unknown, opts: unknown) => {
        options.push(opts);
        return 0;
      }),
    };
    const loader = new BrandLoader(prisma as never, {} as never, {} as never);
    await loader.load([]);
    return options[0];
  };

  it('is 60000 ms when the variable is not set', async () => {
    delete process.env['BRAND_LOAD_TIMEOUT_MS'];
    expect(await timeoutUsed()).toEqual({ timeout: 60_000 });
  });

  it('follows BRAND_LOAD_TIMEOUT_MS when it is set', async () => {
    process.env['BRAND_LOAD_TIMEOUT_MS'] = '123456';
    expect(await timeoutUsed()).toEqual({ timeout: 123_456 });
  });
});
