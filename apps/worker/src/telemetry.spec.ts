const mockStartTelemetry = jest.fn();

jest.mock('@motor-fix/observability', () => ({
  startTelemetry: (...args: unknown[]) => mockStartTelemetry(...args),
}));

// @traces 876-FR-001
describe('the worker telemetry loader', () => {
  it('starts telemetry for the worker service once, on import', async () => {
    await jest.isolateModulesAsync(async () => {
      await import('./telemetry');
    });

    expect(mockStartTelemetry).toHaveBeenCalledTimes(1);
    expect(mockStartTelemetry).toHaveBeenCalledWith('worker');
  });
});
