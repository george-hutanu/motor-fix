import { randomUUID } from 'node:crypto';

import type { AppEnv } from '@motor-fix/contracts';
import { JsonLogger, requestContext } from '@motor-fix/domain';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { NextFunction, Request, Response } from 'express';

import { ProblemFilter, sendProblem } from './problem.filter';

// A client's id is kept only when it is short and plain, so it cannot flood or
// forge log lines.
const REQUEST_ID = /^[\w.-]{1,128}$/;

export function configureApp(app: INestApplication, env: { APP_ENV: AppEnv }) {
  app.useLogger(new JsonLogger());
  app.use((req: Request, res: Response, next: NextFunction) => {
    const given = req.header('x-request-id');
    const requestId = given && REQUEST_ID.test(given) ? given : randomUUID();
    res.setHeader('X-Request-Id', requestId);
    requestContext.run({ requestId }, next);
  });
  // Nest answers unknown routes only under the global prefix; the API has
  // nothing outside it but the health checks.
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.path.startsWith('/api/') || req.path.startsWith('/health/')) {
      return next();
    }
    sendProblem(res, 404, 'not_found');
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
