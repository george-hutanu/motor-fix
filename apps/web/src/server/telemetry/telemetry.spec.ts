/**
 * @jest-environment @stryker-mutator/jest-runner/jest-env/node
 */
import { startTelemetry } from '@motor-fix/observability';

jest.mock('@motor-fix/observability', () => ({
  logEntry: jest.fn(),
  startTelemetry: jest.fn(),
  telemetryStarted: jest.fn(),
}));

type Observability = {
  logEntry: jest.Mock;
  telemetryStarted: jest.Mock;
};

describe('the web server telemetry entry', () => {
  it('starts telemetry as the web service when loaded', async () => {
    await import('./telemetry');

    expect(startTelemetry).toHaveBeenCalledTimes(1);
    expect(startTelemetry).toHaveBeenCalledWith('web');
  });
});

// @traces 1345-FR-005
describe('the web server telemetry entry and the browser collector', () => {
  beforeEach(() => jest.clearAllMocks());

  // Each case loads the entry in a fresh registry, so the mocks it calls are
  // the ones that registry made.
  async function load(started: boolean, faro: string | undefined) {
    const saved = process.env;
    process.env = { ...saved };
    if (faro === undefined) delete process.env['FARO_URL'];
    else process.env['FARO_URL'] = faro;
    let observability: Observability | undefined;
    try {
      await jest.isolateModulesAsync(async () => {
        observability = jest.requireMock<Observability>(
          '@motor-fix/observability',
        );
        observability.telemetryStarted.mockReturnValue(started);
        await import('./telemetry');
      });
    } finally {
      process.env = saved;
    }
    return observability as Observability;
  }

  it('warns once that browser telemetry is off when FARO_URL is unset', async () => {
    const { logEntry } = await load(true, undefined);

    expect(logEntry.mock.calls).toEqual([
      ['warn', 'browser telemetry off: FARO_URL unset'],
    ]);
  });

  it('says nothing when FARO_URL is set', async () => {
    const { logEntry } = await load(true, 'https://faro.example.com/collect/k');

    expect(logEntry).not.toHaveBeenCalled();
  });

  it('says nothing when telemetry itself is off', async () => {
    const { logEntry } = await load(false, undefined);

    expect(logEntry).not.toHaveBeenCalled();
  });
});
