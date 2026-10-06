const mockListen = jest.fn();
const mockReadEnv = jest.fn();

jest.mock('@motor-fix/contracts/env', () => ({
  readEnv: (...args: unknown[]) => mockReadEnv(...args),
}));
jest.mock('./server', () => ({
  createServer: () => ({ listen: mockListen }),
}));

async function start(port: string | undefined) {
  const before = process.env['PORT'];
  if (port === undefined) delete process.env['PORT'];
  else process.env['PORT'] = port;
  try {
    await jest.isolateModulesAsync(async () => {
      await import('./main');
    });
  } finally {
    if (before === undefined) delete process.env['PORT'];
    else process.env['PORT'] = before;
  }
}

describe('mcp entry point', () => {
  beforeEach(() => jest.clearAllMocks());

  it('checks the environment, needing nothing of its own', async () => {
    await start(undefined);

    expect(mockReadEnv).toHaveBeenCalledWith([]);
  });

  it('listens on port 3002 by default', async () => {
    await start(undefined);

    expect(mockListen).toHaveBeenCalledWith(3002);
  });

  it('listens on the port it is given', async () => {
    await start('4100');

    expect(mockListen).toHaveBeenCalledWith(4100);
  });
});
