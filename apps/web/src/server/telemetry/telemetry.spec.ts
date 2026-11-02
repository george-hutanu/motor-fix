import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { vi } from 'vitest';

import { startWebTelemetry } from './telemetry';

type Lib = NonNullable<Parameters<typeof startWebTelemetry>[0]>;

function double(started: boolean) {
  return {
    logEntry: vi.fn(),
    startTelemetry: vi.fn(),
    telemetryStarted: vi.fn(() => started),
  };
}

// Runs the entry against a double of the library with FARO_URL as given.
function run(started: boolean, faro: string | undefined) {
  const lib = double(started);
  const saved = process.env;
  process.env = { ...saved };
  if (faro === undefined) delete process.env['FARO_URL'];
  else process.env['FARO_URL'] = faro;
  try {
    startWebTelemetry(lib as unknown as Lib);
  } finally {
    process.env = saved;
  }
  return lib;
}

describe('the web server telemetry entry', () => {
  // @traces 1332-FR-020
  // The unit-test build bundles @motor-fix/observability, so no module mock
  // reaches the call the entry makes on load; its source must make it.
  it('starts telemetry as the web service when loaded', () => {
    const source = readFileSync(join(__dirname, 'telemetry.ts'), 'utf8');

    expect(source.trimEnd().split('\n').at(-1)).toBe('startWebTelemetry();');
  });

  it('starts telemetry as the web service', () => {
    const { startTelemetry } = run(false, undefined);

    expect(startTelemetry).toHaveBeenCalledTimes(1);
    expect(startTelemetry).toHaveBeenCalledWith('web');
  });
});

// @traces 1345-FR-005
describe('the web server telemetry entry and the browser collector', () => {
  it('warns once that browser telemetry is off when FARO_URL is unset', () => {
    const { logEntry } = run(true, undefined);

    expect(logEntry.mock.calls).toEqual([
      ['warn', 'browser telemetry off: FARO_URL unset'],
    ]);
  });

  it('says nothing when FARO_URL is set', () => {
    const { logEntry } = run(true, 'https://faro.example.com/collect/k');

    expect(logEntry).not.toHaveBeenCalled();
  });

  it('says nothing when telemetry itself is off', () => {
    const { logEntry } = run(false, undefined);

    expect(logEntry).not.toHaveBeenCalled();
  });
});
