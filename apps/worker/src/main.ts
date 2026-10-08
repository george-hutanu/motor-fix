import './telemetry';

import { readEnv } from '@motor-fix/contracts';
import { JsonLogger } from '@motor-fix/domain';
import { NestFactory } from '@nestjs/core';
import { ExpressAdapter } from '@nestjs/platform-express';

import { WORKER_ENV, workerModule } from './worker.module';

async function bootstrap() {
  const env = readEnv(WORKER_ENV);
  const app = await NestFactory.create(
    workerModule(env),
    new ExpressAdapter(),
    { logger: new JsonLogger() },
  );
  app.enableShutdownHooks();
  await app.listen(Number(process.env['PORT'] ?? 3001));
}

void bootstrap();
