import { readEnv } from '@motor-fix/contracts';
import { HealthModule, JsonLogger } from '@motor-fix/domain';
import { NestFactory } from '@nestjs/core';

// The worker serves no routes of its own: its HTTP listener exists so that
// Railway can health-check it.
async function bootstrap() {
  const env = readEnv(['DATABASE_URL', 'REDIS_URL']);
  const app = await NestFactory.create(
    HealthModule.register({
      databaseUrl: env.DATABASE_URL,
      redisUrl: env.REDIS_URL,
      version: env.RELEASE_SHA,
    }),
    { logger: new JsonLogger() },
  );
  app.enableShutdownHooks();
  await app.listen(Number(process.env['PORT'] ?? 3001));
}

void bootstrap();
