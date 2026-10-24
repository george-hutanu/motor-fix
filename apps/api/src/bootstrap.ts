import { randomUUID } from 'node:crypto';

import { type AppEnv, imageBaseUrl } from '@motor-fix/contracts';
import { JsonLogger, requestContext } from '@motor-fix/domain';
import { routeLabel } from '@motor-fix/observability';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { json, type NextFunction, type Request, type Response } from 'express';

import { ProblemFilter, sendProblem } from './problem.filter';

// A client's id is kept only when it is short and plain, so it cannot flood or
// forge log lines.
const REQUEST_ID = /^[\w.-]{1,128}$/;

// The browser reaches the API through Railway's edge (100.64.0.0/10) and the
// web app's edge, each appending the address it saw. Trust is a list of ranges,
// never a hop count, so an address the visitor writes into X-Forwarded-For is
// never taken as req.ip.
export const TRUSTED_PROXIES =
  'loopback, linklocal, uniquelocal, 100.64.0.0/10';

export function configureApp(app: INestApplication, env: { APP_ENV: AppEnv }) {
  // A bad image address fails the boot, not every garage profile read.
  imageBaseUrl();
  app.useLogger(new JsonLogger());
  app.getHttpAdapter().getInstance().set('trust proxy', TRUSTED_PROXIES);
  // A listing draft holds up to 256 KB of form data, past the 100 KB every
  // other route reads; the draft's own limit answers above that with
  // draft_too_large. A body read here is not read again by Nest's parser.
  app.use('/api/v1/listing-drafts', json({ limit: '320kb' }));
  (app as NestExpressApplication).useBodyParser('json', { limit: '100kb' });
  app.use(routeLabel());
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
    new DocumentBuilder()
      .setTitle('MotorFix API')
      .setVersion('1')
      .addBearerAuth()
      .build(),
  );
}
