import { nestPreset } from '../../vitest.preset.mts';

export default nestPreset(import.meta.dirname, {
  setupFiles: ['src/testing/otel-reset.ts'],
});
