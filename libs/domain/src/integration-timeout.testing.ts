// Specs that need PostgreSQL or Redis get 30 seconds per test and per hook:
// a busy machine slows their setup and bulk writes well past Jest's 5. A
// test or hook that runs over still fails, naming itself; unit specs keep 5.
if (/\.integration\.spec\.ts$/.test(expect.getState().testPath ?? ''))
  jest.setTimeout(30_000);
