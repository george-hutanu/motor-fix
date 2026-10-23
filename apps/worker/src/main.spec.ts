const mockApp = {
  enableShutdownHooks: jest.fn(),
  listen: jest.fn(async () => undefined),
};

jest.mock('./telemetry', () => ({}));
jest.mock('@motor-fix/contracts', () => ({ readEnv: () => ({}) }));
jest.mock('@motor-fix/domain', () => ({
  initProductCounters: jest.fn(),
  JsonLogger: class JsonLogger {},
}));
jest.mock('@nestjs/core', () => ({
  NestFactory: { create: async () => mockApp },
}));
jest.mock('@nestjs/platform-express', () => ({
  ExpressAdapter: class ExpressAdapter {},
}));
jest.mock('./commands', () => ({ runCommand: async () => null }));
jest.mock('./worker.module', () => ({
  WORKER_ENV: [],
  workerModule: () => 'worker module',
}));

async function serve(env: Record<string, string | undefined>) {
  const before = {
    PORT: process.env['PORT'],
    WORKER_PORT: process.env['WORKER_PORT'],
  };
  const set = (values: Record<string, string | undefined>) => {
    for (const [key, value] of Object.entries(values))
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
  };
  set({ PORT: undefined, WORKER_PORT: undefined, ...env });
  try {
    await jest.isolateModulesAsync(async () => {
      await import('./main');
    });
    for (let i = 0; i < 10; i++)
      await new Promise((resolve) => setImmediate(resolve));
  } finally {
    set(before);
  }
}

// The first import compiles main.ts and what it imports.
jest.setTimeout(30_000);

// @traces 1363-FR-005
describe('worker entry point', () => {
  beforeEach(() => jest.clearAllMocks());

  it('serves on port 3001 by default', async () => {
    await serve({});
    expect(mockApp.listen).toHaveBeenCalledWith(3001);
  });

  it('serves on the PORT it is given', async () => {
    await serve({ PORT: '4001' });
    expect(mockApp.listen).toHaveBeenCalledWith(4001);
  });

  it("serves on WORKER_PORT over PORT, which a worktree's port set gives the web dev server", async () => {
    await serve({ PORT: '50004', WORKER_PORT: '50003' });
    expect(mockApp.listen).toHaveBeenCalledWith(50003);
  });
});
