import { inMemory, patchForJest } from '.';

describe('the testing helpers', () => {
  it('give in-memory exporters and a reader that collects on demand', async () => {
    const memory = inMemory();

    expect(memory.spanExporter.getFinishedSpans()).toEqual([]);
    expect(memory.logExporter.getFinishedLogRecords()).toEqual([]);
    expect(typeof memory.metricReader.collect).toBe('function');
  });

  it('patch nothing while telemetry is off', () => {
    expect(() => patchForJest()).not.toThrow();
  });
});
