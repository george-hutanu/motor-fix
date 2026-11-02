import { vi } from 'vitest';

import { startWebTelemetry } from './telemetry';

type Lib = NonNullable<Parameters<typeof startWebTelemetry>[0]>;

function run(started: boolean, faro: string | undefined) {
  const observability = {
    logEntry: vi.fn(),
    startTelemetry: vi.fn(),
    telemetryStarted: vi.fn(() => started),
  };
  const saved = process.env;
  process.env = { ...saved };
  if (faro === undefined) delete process.env['FARO_URL'];
  else process.env['FARO_URL'] = faro;
  let failure: unknown;
  try {
    startWebTelemetry(observability as unknown as Lib);
  } catch (error) {
    failure = error;
  } finally {
    process.env = saved;
  }
  return { failure, observability };
}

// @traces 1345-FR-005
describe('the web server telemetry entry with hostile FARO_URL values', () => {
  it('warns once when FARO_URL is set to an empty string', () => {
    const { observability } = run(true, '');

    expect(observability.logEntry.mock.calls).toEqual([
      ['warn', 'browser telemetry off: FARO_URL unset'],
    ]);
  });

  it('refuses to start when FARO_URL is only blanks, with no warning', () => {
    const { failure, observability } = run(true, '   ');

    expect(String(failure)).toContain(
      'FARO_URL must be an absolute http(s) URL',
    );
    expect(observability.logEntry).not.toHaveBeenCalled();
  });

  it('never prints a malformed FARO_URL in any log entry', () => {
    const { observability } = run(true, 'not a url/collect/appkey123');

    expect(JSON.stringify(observability.logEntry.mock.calls)).not.toContain(
      'appkey123',
    );
  });

  it('starts telemetry before it asks whether telemetry started', () => {
    const { observability } = run(true, undefined);

    const start = observability.startTelemetry.mock.invocationCallOrder[0];
    const asked = observability.telemetryStarted.mock.invocationCallOrder[0];
    expect(start).toBeLessThan(asked as number);
  });

  it('says nothing for a valid FARO_URL even with telemetry off', () => {
    const { observability } = run(false, 'https://faro.example.com/c/k');

    expect(observability.logEntry).not.toHaveBeenCalled();
  });
});
