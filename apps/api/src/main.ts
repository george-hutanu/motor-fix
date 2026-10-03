import { writeFileSync } from 'node:fs';

import { readEnv } from '@motor-fix/contracts';
import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module';
import { configureApp, openApiDocument } from './bootstrap';

async function bootstrap() {
  const env = readEnv(['DATABASE_URL', 'REDIS_URL']);
  const app = await NestFactory.create(AppModule.register(env), {
    bufferLogs: true,
  });
  configureApp(app, env);
  const [command, target] = process.argv.slice(2);
  if (command === 'openapi' && target) {
    writeFileSync(target, `${JSON.stringify(openApiDocument(app), null, 2)}\n`);
    await app.close();
    return;
  }
  app.enableShutdownHooks();
  await app.listen(Number(process.env['PORT'] ?? 3000));
}

void bootstrap();
