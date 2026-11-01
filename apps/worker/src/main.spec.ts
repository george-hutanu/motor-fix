const mockApp = {
  enableShutdownHooks: vi.fn(),
  listen: vi.fn(async () => undefined),
};

vi.mock('./telemetry', () => ({}));
vi.mock('@motor-fix/contracts', () => ({ readEnv: () => ({}) }));
vi.mock('@motor-fix/domain', () => ({
  initProductCounters: vi.fn(),
  JsonLogger: class JsonLogger {},
}));
vi.mock('@nestjs/core', () => ({
  NestFactory: { create: async () => mockApp },
}));
vi.mock('@nestjs/platform-express', () => ({
  ExpressAdapter: class ExpressAdapter {},
}));
vi.mock('./commands', () => ({ runCommand: async () => null }));
vi.mock('./worker.module', () => ({
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
    vi.resetModules();
    await import('./main');
    for (let i = 0; i < 10; i++)
      await new Promise((resolve) => setImmediate(resolve));
  } finally {
    set(before);
  }
}

// The first import compiles main.ts and what it imports.
vi.setConfig({ hookTimeout: 30_000, testTimeout: 30_000 });

// @traces 1363-FR-005
describe('worker entry point', () => {
  beforeEach(() => vi.clearAllMocks());

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
