import { type Mock, vi } from 'vitest';

vi.mock('@motor-fix/observability', () => ({
  logEntry: vi.fn(),
  startTelemetry: vi.fn(),
  telemetryStarted: vi.fn(),
}));

type Observability = {
  logEntry: Mock;
  startTelemetry: Mock;
  telemetryStarted: Mock;
};

async function load(started: boolean, faro: string | undefined) {
  const saved = process.env;
  process.env = { ...saved };
  if (faro === undefined) delete process.env['FARO_URL'];
  else process.env['FARO_URL'] = faro;
  let observability: Observability | undefined;
  let failure: unknown;
  try {
    vi.resetModules();
    observability = (await import(
      '@motor-fix/observability'
    )) as unknown as Observability;
    observability.telemetryStarted.mockReturnValue(started);
    await import('./telemetry');
  } catch (error) {
    failure = error;
  } finally {
    process.env = saved;
  }
  return { failure, observability: observability as Observability };
}

// @traces 1345-FR-005
describe('the web server telemetry entry with hostile FARO_URL values', () => {
  it('warns once when FARO_URL is set to an empty string', async () => {
    const { observability } = await load(true, '');

    expect(observability.logEntry.mock.calls).toEqual([
      ['warn', 'browser telemetry off: FARO_URL unset'],
    ]);
  });

  it('refuses to start when FARO_URL is only blanks, with no warning', async () => {
    const { failure, observability } = await load(true, '   ');

    expect(String(failure)).toContain(
      'FARO_URL must be an absolute http(s) URL',
    );
    expect(observability.logEntry).not.toHaveBeenCalled();
  });

  it('never prints a malformed FARO_URL in any log entry', async () => {
    const { observability } = await load(true, 'not a url/collect/appkey123');

    expect(JSON.stringify(observability.logEntry.mock.calls)).not.toContain(
      'appkey123',
    );
  });

  it('starts telemetry before it asks whether telemetry started', async () => {
    const { observability } = await load(true, undefined);

    const start = observability.startTelemetry.mock.invocationCallOrder[0];
    const asked = observability.telemetryStarted.mock.invocationCallOrder[0];
    expect(start).toBeLessThan(asked as number);
  });

  it('says nothing for a valid FARO_URL even with telemetry off', async () => {
    const { observability } = await load(false, 'https://faro.example.com/c/k');

    expect(observability.logEntry).not.toHaveBeenCalled();
  });
});
