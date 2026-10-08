const { TestEnvironment } = require('jest-environment-node');

// Jest runs afterAll hooks in the order they were declared, so a turn given
// back in an afterAll would go before the spec's own teardown (closing its
// app, queues and workers), which can still write. serialDatabase hands its
// release here instead, and it runs once the whole file is done.
class DatabaseTurnEnvironment extends TestEnvironment {
  releases = [];

  constructor(config, context) {
    super(config, context);
    this.global.releaseDatabaseTurnLast = (release) => {
      this.releases.push(release);
    };
  }

  async teardown() {
    try {
      for (const release of this.releases.splice(0)) await release();
    } finally {
      await super.teardown();
    }
  }
}

module.exports = DatabaseTurnEnvironment;
