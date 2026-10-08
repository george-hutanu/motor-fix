import { queueTelemetry } from './telemetry-option';

jest.mock('../setup/start', () => ({ telemetryStarted: () => true }));
jest.mock('bullmq-otel', () => {
  throw new Error('bullmq-otel failed to load');
});

// @traces 876-FR-014
describe('queueTelemetry when bullmq-otel cannot load', () => {
  it('returns undefined and writes one error line instead of throwing', () => {
    const errors = jest.spyOn(console, 'error').mockImplementation(() => {});

    expect(queueTelemetry()).toBeUndefined();

    expect(errors).toHaveBeenCalledTimes(1);
    errors.mockRestore();
  });
});
