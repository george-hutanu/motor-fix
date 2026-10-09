const mockListen = jest.fn();
const mockEnableShutdownHooks = jest.fn();
const mockCreateMcpApp = jest.fn();
const mockReadEnv = jest.fn();

jest.mock('@motor-fix/contracts', () => ({
  readEnv: (...args: unknown[]) => mockReadEnv(...args),
}));
jest.mock('./telemetry', () => ({}));
jest.mock('./mcp.module', () => ({
  createMcpApp: (...args: unknown[]) => mockCreateMcpApp(...args),
  MCP_ENV: ['DATABASE_URL', 'MCP_URL', 'ASSISTANT_ISSUER'],
}));

async function start(port: string | undefined) {
  const before = process.env['PORT'];
  if (port === undefined) delete process.env['PORT'];
  else process.env['PORT'] = port;
  try {
    await jest.isolateModulesAsync(async () => {
      await import('./main');
    });
    await new Promise((resolve) => setImmediate(resolve));
  } finally {
    if (before === undefined) delete process.env['PORT'];
    else process.env['PORT'] = before;
  }
}

describe('mcp entry point', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockReadEnv.mockReturnValue({
      APP_ENV: 'test',
      ASSISTANT_ISSUER:
        'https://id.motorfix.example/realms/motorfix-assistants',
      DATABASE_URL: 'postgresql://localhost/db',
      MCP_URL: 'https://mcp.motorfix.example/mcp',
    });
    mockCreateMcpApp.mockResolvedValue({
      enableShutdownHooks: mockEnableShutdownHooks,
      listen: mockListen,
    });
  });

  it('checks the database, the MCP address and the identity server are set', async () => {
    await start(undefined);

    expect(mockReadEnv).toHaveBeenCalledWith([
      'DATABASE_URL',
      'MCP_URL',
      'ASSISTANT_ISSUER',
    ]);
    expect(mockCreateMcpApp).toHaveBeenCalledWith({
      databaseUrl: 'postgresql://localhost/db',
      issuer: 'https://id.motorfix.example/realms/motorfix-assistants',
      mcpUrl: 'https://mcp.motorfix.example/mcp',
    });
    expect(mockEnableShutdownHooks).toHaveBeenCalled();
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
