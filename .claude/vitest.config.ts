import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// The harness's own vitest project, deliberately NOT registered in the root
// vitest.config.ts: that file is tracked and pushed, while everything under
// .claude/ is git-excluded here, so a tracked config naming this project would
// point at nothing for anyone else who clones the repo.
//
// Run it on its own:
//
//   npx vitest run --config .claude/vitest.config.ts
//
// `root` is pinned to this directory so the run cannot wander into a sibling
// worktree that shares the same .claude (.worktrees/* would otherwise be
// collected twice). The gates and scripts are plain ESM with no build step and
// no DOM, so the project owns nothing but an include; specs sit beside the
// file they cover, the way they do in apps/ and libs/.
export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  test: {
    name: "harness",
    include: ["**/*.spec.mjs"],
    // apple-design-skill is a vendored reference tree.
    exclude: ["**/node_modules/**", "skills/apple-design-skill/**"],
    environment: "node",
  },
});
