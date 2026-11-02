import { afterAll } from 'vitest';

// Vitest runs afterAll hooks in reverse order of registration, and this setup
// file registers its own before the spec file does: a turn handed here is
// given back after the spec's whole teardown (closing its app, queues and
// workers, which can still write), never before it. serialDatabase and
// apiBoot hand their release here.
const releases: (() => Promise<void>)[] = [];

(
  globalThis as {
    releaseDatabaseTurnLast?: (release: () => Promise<void>) => void;
  }
).releaseDatabaseTurnLast = (release) => {
  releases.push(release);
};

afterAll(async () => {
  for (const release of releases.splice(0)) await release();
});
