import { nestPreset } from '../../vitest.preset.mts';

export default nestPreset(import.meta.dirname, {
  setupFiles: ['../../libs/domain/src/auth/database-turn.setup.ts'],
});
