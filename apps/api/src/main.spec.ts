const mockLoad = vi.fn(async (..._args: unknown[]) => ({ changed: 0 }));
const mockFill = vi.fn(async () => ({ written: 0 }));
const mockApp = {
  close: vi.fn(async () => undefined),
  enableShutdownHooks: vi.fn(),
  get: vi.fn((..._args: unknown[]) => ({ fill: mockFill, load: mockLoad })),
  listen: vi.fn(async () => undefined),
};
const mockCreate = vi.fn(async (..._args: unknown[]) => mockApp);
const mockReadEnv = vi.fn(
  (..._args: unknown[]): { APP_ENV: string; RELEASE_SHA?: string } => ({
    APP_ENV: 'test',
  }),
);
const mockRegister = vi.fn((..._args: unknown[]) => 'registered module');
const mockConfigure = vi.fn();
const mockWrite = vi.fn();
const mockWarm = vi.fn(
  (..._args: unknown[]) => new Promise<void>(() => undefined),
);

vi.mock('node:fs', async (actualModule) => ({
  ...(await actualModule<typeof import('node:fs')>()),
  writeFileSync: (...args: unknown[]) => mockWrite(...args),
}));
vi.mock('@motor-fix/contracts', () => ({
  readEnv: (...args: unknown[]) => mockReadEnv(...args),
  STORAGE_ENV: ['S3_BUCKET'],
}));
vi.mock('@motor-fix/domain', () => ({
  AREAS: ['the area file'],
  AreaLoader: class AreaLoader {},
  BRANDS: ['the brand file'],
  BrandLoader: class BrandLoader {},
  CAR_MODELS: ['the car model file'],
  initProductCounters: vi.fn(),
  JOB_TYPES: ['the job file'],
  JobTypeLoader: class JobTypeLoader {},
  Models3dLoader: class Models3dLoader {},
  Models3dStore: class Models3dStore {},
  warmCache: (...args: unknown[]) => mockWarm(...args),
}));
vi.mock('@nestjs/core', () => ({
  NestFactory: { create: (...args: unknown[]) => mockCreate(...args) },
}));
vi.mock('@nestjs/platform-express', () => ({
  ExpressAdapter: class ExpressAdapter {},
}));
vi.mock('./app.module', () => ({
  AppModule: { register: (...args: unknown[]) => mockRegister(...args) },
}));
vi.mock('./bootstrap', () => ({
  configureApp: (...args: unknown[]) => mockConfigure(...args),
  openApiDocument: () => ({ openapi: '3.0.0' }),
}));

function setEnv(values: Record<string, string | undefined>) {
  for (const [key, value] of Object.entries(values))
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
}

async function run(args: string[], port?: string, apiPort?: string) {
  const argv = process.argv;
  const before = {
    API_PORT: process.env['API_PORT'],
    PORT: process.env['PORT'],
  };
  process.argv = ['node', 'main.js', ...args];
  setEnv({ API_PORT: apiPort, PORT: port });
  try {
    vi.resetModules();
    await import('./main');
    for (let i = 0; i < 10; i++)
      await new Promise((resolve) => setImmediate(resolve));
  } finally {
    process.argv = argv;
    setEnv(before);
  }
}

// The first import compiles main.ts and what it imports, which can take more
// than the runner's 5 s default on a loaded CI runner.
vi.setConfig({ hookTimeout: 30_000, testTimeout: 30_000 });

describe('api entry point', () => {
  beforeEach(() => vi.clearAllMocks());

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

  // @traces 1182-FR-013
  it('warms the cache for its release once it serves, without waiting for it', async () => {
    mockReadEnv.mockReturnValueOnce({ APP_ENV: 'test', RELEASE_SHA: 'abc123' });

    await run([]);

    expect(mockWarm).toHaveBeenCalledWith(mockApp, 'abc123');
    expect(mockApp.listen.mock.invocationCallOrder[0]).toBeLessThan(
      mockWarm.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it('serves on the port it is given', async () => {
    await run([], '4000');

    expect(mockApp.listen).toHaveBeenCalledWith(4000);
  });

  // @traces 1363-FR-005
  it("serves on API_PORT over PORT, which a worktree's port set gives the web dev server", async () => {
    await run([], '50004', '50002');

    expect(mockApp.listen).toHaveBeenCalledWith(50002);
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

  // @traces 1241-FR-002
  it('loads the 3D car catalogue after the brands and the jobs, before it serves', async () => {
    await run([]);

    const loaders = (mockApp.get.mock.calls as [{ name: string }][]).map(
      ([loader]) => loader.name,
    );
    expect(loaders.slice(0, 3)).toEqual([
      'BrandLoader',
      'JobTypeLoader',
      'Models3dLoader',
    ]);
    expect(mockLoad).toHaveBeenNthCalledWith(3, ['the car model file']);
    expect(mockLoad.mock.invocationCallOrder[2]).toBeLessThan(
      mockApp.listen.mock.invocationCallOrder[0] ?? 0,
    );
  });

  // @traces 106-FR-001
  it('loads the areas after the catalogues, before it serves', async () => {
    await run([]);

    const loaders = (mockApp.get.mock.calls as [{ name: string }][]).map(
      ([loader]) => loader.name,
    );
    expect(loaders.slice(0, 4)).toEqual([
      'BrandLoader',
      'JobTypeLoader',
      'Models3dLoader',
      'AreaLoader',
    ]);
    expect(mockLoad).toHaveBeenNthCalledWith(4, ['the area file']);
    expect(mockLoad.mock.invocationCallOrder[3]).toBeLessThan(
      mockApp.listen.mock.invocationCallOrder[0] ?? 0,
    );
  });

  // @traces 035-FR-007
  it('fills the 3D file store after the catalogues and the areas, before it serves', async () => {
    await run([]);

    const loaders = (mockApp.get.mock.calls as [{ name: string }][]).map(
      ([loader]) => loader.name,
    );
    expect(loaders.slice(3, 5)).toEqual(['AreaLoader', 'Models3dStore']);
    expect(mockFill).toHaveBeenCalledTimes(1);
    expect(mockLoad.mock.invocationCallOrder[3]).toBeLessThan(
      mockFill.mock.invocationCallOrder[0] ?? 0,
    );
    expect(mockFill.mock.invocationCallOrder[0]).toBeLessThan(
      mockApp.listen.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it('stops with exit code 1, never serving, when the brand file cannot load', async () => {
    const exit = vi
      .spyOn(process, 'exit')
      .mockImplementation((() => undefined) as never);
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
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
