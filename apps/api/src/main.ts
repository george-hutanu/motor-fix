import { writeFileSync } from 'node:fs';

import { readEnv, STORAGE_ENV } from '@motor-fix/contracts';
import {
  BRANDS,
  BrandLoader,
  JOB_TYPES,
  JobTypeLoader,
} from '@motor-fix/domain';
import { NestFactory } from '@nestjs/core';
import { ExpressAdapter } from '@nestjs/platform-express';

import { AppModule } from './app.module';
import { configureApp, openApiDocument } from './bootstrap';

async function bootstrap() {
  const env = readEnv([
    'DATABASE_URL',
    'REDIS_URL',
    'AUTH_TOKEN_SECRET',
    ...STORAGE_ENV,
  ]);
  const app = await NestFactory.create(
    AppModule.register(env),
    new ExpressAdapter(),
    { bufferLogs: true },
  );
  configureApp(app, env);
  const [command, target] = process.argv.slice(2);
  if (command === 'openapi' && target) {
    writeFileSync(target, `${JSON.stringify(openApiDocument(app), null, 2)}\n`);
    await app.close();
    return;
  }
  await app.get(BrandLoader).load(BRANDS);
  await app.get(JobTypeLoader).load(JOB_TYPES);
  app.enableShutdownHooks();
  await app.listen(Number(process.env['PORT'] ?? 3000));
}

// A brand or job file that cannot load stops the process before it serves.
bootstrap().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
