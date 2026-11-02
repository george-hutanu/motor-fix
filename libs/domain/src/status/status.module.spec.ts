import { StatusController } from './status.controller';
import { StatusModule } from './status.module';

// @traces 295-FR-001
describe('the status module for the API', () => {
  it('serves the admin read alone, with no job, queue or limits of its own', () => {
    const registered = StatusModule.register();

    expect([
      registered.module,
      registered.controllers,
      registered.providers ?? [],
      registered.imports ?? [],
    ]).toEqual([StatusModule, [StatusController], [], []]);
  });
});
