import { storageTelemetry } from './middleware';

// @traces 878-FR-011
describe('storageTelemetry while telemetry is off', () => {
  it('gives the storage client no middleware', () => {
    expect(storageTelemetry('motorfix')).toBeUndefined();
  });
});
