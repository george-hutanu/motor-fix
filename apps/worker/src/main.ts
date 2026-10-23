import './telemetry';

import { readEnv } from '@motor-fix/contracts';
import { initProductCounters, JsonLogger } from '@motor-fix/domain';
import { NestFactory } from '@nestjs/core';
import { ExpressAdapter } from '@nestjs/platform-express';

import { runCommand } from './commands';
import { WORKER_ENV, workerModule } from './worker.module';

initProductCounters('worker');

async function bootstrap() {
  const env = readEnv(WORKER_ENV);
  const app = await NestFactory.create(
    workerModule(env),
    new ExpressAdapter(),
    { logger: new JsonLogger() },
  );
  app.enableShutdownHooks();
  // WORKER_PORT first: a worktree's port set (scripts/test-services.ts ports) gives
  // PORT to the web dev server, which reads nothing else.
  await app.listen(
    Number(process.env['WORKER_PORT'] ?? process.env['PORT'] ?? 3001),
  );
}

// `inbox-test` and `email-dns-check` run and exit; anything else boots.
void runCommand(process.argv.slice(2), process.env).then((code) =>
  code === null ? bootstrap() : process.exit(code),
);
