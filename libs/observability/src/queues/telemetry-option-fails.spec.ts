import Module from 'node:module';

import { queueTelemetry } from './telemetry-option';

vi.mock('../setup/start', () => ({ telemetryStarted: () => true }));

// queueTelemetry loads bullmq-otel with Node's own require, which vi.mock
// does not reach, so the failing load is staged on Module's require.
const load = Module.prototype.require;
vi.spyOn(Module.prototype, 'require').mockImplementation(function (
  this: NodeJS.Module,
  id: string,
) {
  if (id === 'bullmq-otel') throw new Error('bullmq-otel failed to load');
  return load.call(this, id);
} as typeof load);

// @traces 876-FR-014
describe('queueTelemetry when bullmq-otel cannot load', () => {
  it('returns undefined and writes one error line instead of throwing', () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(queueTelemetry()).toBeUndefined();

    expect(errors).toHaveBeenCalledTimes(1);
    expect(String(errors.mock.calls[0]?.[0])).toContain(
      'bullmq-otel failed to load',
    );
    errors.mockRestore();
  });
});
