const mockStartTelemetry = jest.fn();

jest.mock('@motor-fix/observability', () => ({
  startTelemetry: (...args: unknown[]) => mockStartTelemetry(...args),
}));

describe('the api telemetry loader', () => {
  it('starts telemetry for the api service once, on import', async () => {
    await jest.isolateModulesAsync(async () => {
      await import('./telemetry');
    });

    expect(mockStartTelemetry).toHaveBeenCalledTimes(1);
    expect(mockStartTelemetry).toHaveBeenCalledWith('api');
  });
});
