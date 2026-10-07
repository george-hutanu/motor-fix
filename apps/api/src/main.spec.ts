const mockLoad = jest.fn(async (..._args: unknown[]) => ({ changed: 0 }));
const mockApp = {
  close: jest.fn(async () => undefined),
  enableShutdownHooks: jest.fn(),
  get: jest.fn((..._args: unknown[]) => ({ load: mockLoad })),
  listen: jest.fn(async () => undefined),
};
const mockCreate = jest.fn(async (..._args: unknown[]) => mockApp);
const mockReadEnv = jest.fn((..._args: unknown[]) => ({ APP_ENV: 'test' }));
const mockRegister = jest.fn((..._args: unknown[]) => 'registered module');
const mockConfigure = jest.fn();
const mockWrite = jest.fn();

jest.mock('node:fs', () => ({
  ...jest.requireActual('node:fs'),
  writeFileSync: (...args: unknown[]) => mockWrite(...args),
}));
jest.mock('@motor-fix/contracts', () => ({
  readEnv: (...args: unknown[]) => mockReadEnv(...args),
  STORAGE_ENV: ['S3_BUCKET'],
}));
jest.mock('@motor-fix/domain', () => ({
  BRANDS: ['the brand file'],
  BrandLoader: class BrandLoader {},
}));
jest.mock('@nestjs/core', () => ({
  NestFactory: { create: (...args: unknown[]) => mockCreate(...args) },
}));
jest.mock('@nestjs/platform-express', () => ({
  ExpressAdapter: class ExpressAdapter {},
}));
jest.mock('./app.module', () => ({
  AppModule: { register: (...args: unknown[]) => mockRegister(...args) },
}));
jest.mock('./bootstrap', () => ({
  configureApp: (...args: unknown[]) => mockConfigure(...args),
  openApiDocument: () => ({ openapi: '3.0.0' }),
}));

async function run(args: string[], port?: string) {
  const argv = process.argv;
  const before = process.env['PORT'];
  process.argv = ['node', 'main.js', ...args];
  if (port === undefined) delete process.env['PORT'];
  else process.env['PORT'] = port;
  try {
    await jest.isolateModulesAsync(async () => {
      await import('./main');
    });
    for (let i = 0; i < 10; i++)
      await new Promise((resolve) => setImmediate(resolve));
  } finally {
    process.argv = argv;
    if (before === undefined) delete process.env['PORT'];
    else process.env['PORT'] = before;
  }
}

describe('api entry point', () => {
  beforeEach(() => jest.clearAllMocks());

  it('builds the app from the environment it checks', async () => {
    await run([]);

    expect(mockReadEnv).toHaveBeenCalledWith([
      'DATABASE_URL',
      'REDIS_URL',
      'AUTH_TOKEN_SECRET',
      'S3_BUCKET',
    ]);
    expect(mockRegister).toHaveBeenCalledWith({ APP_ENV: 'test' });
    expect(mockCreate).toHaveBeenCalledWith(
      'registered module',
      expect.objectContaining({ constructor: expect.any(Function) }),
      { bufferLogs: true },
    );
    expect(mockConfigure).toHaveBeenCalledWith(mockApp, { APP_ENV: 'test' });
  });

  it('serves on port 3000 by default with shutdown hooks on', async () => {
    await run([]);

    expect(mockApp.enableShutdownHooks).toHaveBeenCalled();
    expect(mockApp.listen).toHaveBeenCalledWith(3000);
  });

  it('serves on the port it is given', async () => {
    await run([], '4000');

    expect(mockApp.listen).toHaveBeenCalledWith(4000);
  });

  it('writes the OpenAPI document to the file named, then stops', async () => {
    await run(['openapi', 'out/openapi.json']);

    expect(mockWrite).toHaveBeenCalledWith(
      'out/openapi.json',
      '{\n  "openapi": "3.0.0"\n}\n',
    );
    expect(mockApp.close).toHaveBeenCalled();
    expect(mockApp.listen).not.toHaveBeenCalled();
    expect(mockLoad).not.toHaveBeenCalled();
  });

  it('loads the brand file before it serves', async () => {
    await run([]);

    const [[loader]] = mockApp.get.mock.calls as [[{ name: string }]];
    expect(loader.name).toBe('BrandLoader');
    expect(mockLoad).toHaveBeenCalledWith(['the brand file']);
    expect(mockLoad.mock.invocationCallOrder[0]).toBeLessThan(
      mockApp.listen.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it('stops with exit code 1, never serving, when the brand file cannot load', async () => {
    const exit = jest
      .spyOn(process, 'exit')
      .mockImplementation((() => undefined) as never);
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});
    mockLoad.mockRejectedValueOnce(new Error('refused'));

    try {
      await run([]);

      expect(mockApp.listen).not.toHaveBeenCalled();
      expect(exit).toHaveBeenCalledWith(1);
    } finally {
      exit.mockRestore();
      error.mockRestore();
    }
  });

  it.each([
    ['openapi without a file', ['openapi']],
    ['another command', ['serve', 'out/openapi.json']],
  ])('serves when given %s', async (_, args) => {
    await run(args);

    expect(mockWrite).not.toHaveBeenCalled();
    expect(mockApp.listen).toHaveBeenCalledWith(3000);
  });
});
