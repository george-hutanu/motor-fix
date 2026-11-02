import { nestPreset } from '../vitest.preset.mts';

// Many of these specs scan the whole repository or spawn a script; on a
// machine shared by several worktrees they outrun the 5 s default.
export default nestPreset(import.meta.dirname, {
  include: ['*.spec.ts'],
  testTimeout: 30_000,
});
