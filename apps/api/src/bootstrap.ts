import { randomUUID } from 'node:crypto';

import type { AppEnv } from '@motor-fix/contracts';
import { JsonLogger, requestContext } from '@motor-fix/domain';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { NextFunction, Request, Response } from 'express';

import { ProblemFilter } from './problem.filter';

export function configureApp(app: INestApplication, env: { APP_ENV: AppEnv }) {
  app.useLogger(new JsonLogger());
  app.use((req: Request, res: Response, next: NextFunction) => {
    const requestId = req.header('x-request-id') || randomUUID();
    res.setHeader('X-Request-Id', requestId);
    requestContext.run({ requestId }, next);
  });
  app.setGlobalPrefix('api/v1', { exclude: ['health/live', 'health/ready'] });
  app.useGlobalPipes(
    new ValidationPipe({
      forbidNonWhitelisted: true,
      transform: true,
      whitelist: true,
    }),
  );
  app.useGlobalFilters(new ProblemFilter());
  if (env.APP_ENV !== 'production') {
    SwaggerModule.setup('api/docs', app, () => openApiDocument(app));
  }
}

export function openApiDocument(app: INestApplication) {
  return SwaggerModule.createDocument(
    app,
    new DocumentBuilder().setTitle('MotorFix API').setVersion('1').build(),
  );
}
