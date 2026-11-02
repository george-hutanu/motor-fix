const mockStartTelemetry = vi.fn();

vi.mock('@motor-fix/observability', () => ({
  startTelemetry: (...args: unknown[]) => mockStartTelemetry(...args),
}));

// @traces 876-FR-001
describe('the api telemetry loader', () => {
  it('starts telemetry for the api service once, on import', async () => {
    vi.resetModules();
    await import('./telemetry');

    expect(mockStartTelemetry).toHaveBeenCalledTimes(1);
    expect(mockStartTelemetry).toHaveBeenCalledWith('api');
  });
});
