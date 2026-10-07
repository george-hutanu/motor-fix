const mockStartTelemetry = jest.fn();

jest.mock('@motor-fix/observability', () => ({
  startTelemetry: (...args: unknown[]) => mockStartTelemetry(...args),
}));

describe('the mcp telemetry loader', () => {
  it('starts telemetry for the mcp service once, on import', async () => {
    await jest.isolateModulesAsync(async () => {
      await import('./telemetry');
    });

    expect(mockStartTelemetry).toHaveBeenCalledTimes(1);
    expect(mockStartTelemetry).toHaveBeenCalledWith('mcp');
  });
});
