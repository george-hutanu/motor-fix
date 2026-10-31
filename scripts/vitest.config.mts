import { nestPreset } from '../vitest.preset.mts';

export default nestPreset(import.meta.dirname, { include: ['*.spec.ts'] });
