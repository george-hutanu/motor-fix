/**
 * @jest-environment @stryker-mutator/jest-runner/jest-env/node
 */
import { startTelemetry } from '@motor-fix/observability';

jest.mock('@motor-fix/observability', () => ({ startTelemetry: jest.fn() }));

describe('the web server telemetry entry', () => {
  it('starts telemetry as the web service when loaded', async () => {
    await import('./telemetry');

    expect(startTelemetry).toHaveBeenCalledTimes(1);
    expect(startTelemetry).toHaveBeenCalledWith('web');
  });
});
