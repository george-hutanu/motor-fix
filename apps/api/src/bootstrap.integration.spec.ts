import { readEnv, STORAGE_ENV } from '@motor-fix/contracts';
import { S3TestStore } from '@motor-fix/domain/testing';
import {
  Body,
  Controller,
  Get,
  INestApplication,
  Logger,
  Post,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { IsString } from 'class-validator';
import request from 'supertest';

import { AppModule } from './app.module';
import { configureApp, openApiDocument } from './bootstrap';

class EchoDto {
  @IsString()
  name!: string;
}

@Controller('probe')
class ProbeController {
  private readonly logger = new Logger('Probe');

  @Post()
  echo(@Body() body: EchoDto) {
    return body;
  }

  @Get('log')
  log() {
    this.logger.log('probe called');
    return {};
  }

  @Get('boom')
  boom() {
    throw new Error('database password is hunter2');
  }
}

const env = {
  APP_ENV: 'test',
  AUTH_TOKEN_SECRET: 'test-secret',
  DATABASE_URL:
    process.env['DATABASE_URL'] ?? 'postgresql://localhost:5432/postgres',
  REDIS_URL: process.env['REDIS_URL'] ?? 'redis://localhost:6379',
  RELEASE_SHA: 'abc123',
} as const;
const store = new S3TestStore();

async function start(appEnv: string = env.APP_ENV) {
  const config = readEnv(
    ['DATABASE_URL', 'REDIS_URL', 'AUTH_TOKEN_SECRET', ...STORAGE_ENV],
    {
      ...env,
      ...store.env(),
      APP_ENV: appEnv,
    },
  );
  const moduleRef = await Test.createTestingModule({
    controllers: [ProbeController],
    imports: [AppModule.register(config)],
  }).compile();
  const app = moduleRef.createNestApplication({ bufferLogs: true });
  configureApp(app, config);
  await app.init();
  return app;
}

describe('api conventions', () => {
  let app: INestApplication;

  beforeAll(() => store.start());
  afterAll(() => store.stop());
  afterEach(() => app.close());

  it('serves health outside the /api/v1 prefix and routes under it', async () => {
    app = await start();
    const http = request(app.getHttpServer());

    await http.get('/health/live').expect(200, { status: 'ok' });
    await http.get('/health/ready').expect(200);
    await http.get('/api/v1/health/live').expect(404);
    await http.post('/api/v1/probe').send({ name: 'a' }).expect(201);
  });

  it('answers an unknown route with problem details', async () => {
    app = await start();

    const res = await request(app.getHttpServer()).get('/api/v1/nope');

    expect(res.status).toBe(404);
    expect(res.headers['content-type']).toContain('application/problem+json');
    expect(res.body).toMatchObject({ code: 'not_found', status: 404 });
  });

  it('asks for sign-in with problem details and its own code', async () => {
    app = await start();

    const res = await request(app.getHttpServer()).get('/api/v1/me');

    expect(res.status).toBe(401);
    expect(res.headers['content-type']).toContain('application/problem+json');
    expect(res.body).toMatchObject({ code: 'sign_in_required', status: 401 });
  });

  it('asks for sign-in before changing the language', async () => {
    app = await start();

    const res = await request(app.getHttpServer())
      .patch('/api/v1/me')
      .send({ language: 'en' });

    expect(res.status).toBe(401);
    expect(res.headers['content-type']).toContain('application/problem+json');
    expect(res.body).toMatchObject({ code: 'sign_in_required', status: 401 });
  });

  it('describes the language change in the OpenAPI document', async () => {
    app = await start();

    const document = openApiDocument(app);
    const operation = document.paths['/api/v1/me']?.patch;
    const body = operation?.requestBody;
    const ref =
      body && 'content' in body
        ? body.content['application/json']?.schema
        : undefined;
    const name = ref && '$ref' in ref ? ref.$ref.split('/').pop() : undefined;
    const schema = name ? document.components?.schemas?.[name] : undefined;

    expect(operation?.responses['200']).toBeDefined();
    expect(schema && 'properties' in schema && schema.properties).toEqual({
      language: expect.objectContaining({ enum: ['ro', 'en'] }),
    });
    expect(schema && 'required' in schema && schema.required).toEqual([
      'language',
    ]);
  });

  it('serves the audit history under the prefix, behind sign-in', async () => {
    app = await start();

    const res = await request(app.getHttpServer()).get('/api/v1/audit-history');

    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ code: 'sign_in_required', status: 401 });
  });

  it('describes the audit history in the OpenAPI document', async () => {
    app = await start();

    const document = openApiDocument(app);
    const operation = document.paths['/api/v1/audit-history']?.get;

    expect(
      operation?.parameters?.map((p) => 'name' in p && p.name).sort(),
    ).toEqual(['actorId', 'area', 'cursor', 'from', 'garageId', 'jobId', 'to']);
    expect(operation?.responses['200']).toBeDefined();
  });

  it('refuses a body with an unknown field', async () => {
    app = await start();

    const res = await request(app.getHttpServer())
      .post('/api/v1/probe')
      .send({ name: 'a', role: 'admin' });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ code: 'validation_failed', status: 400 });
  });

  it('hides the cause of an unknown error', async () => {
    app = await start();

    const res = await request(app.getHttpServer()).get('/api/v1/probe/boom');

    expect(res.status).toBe(500);
    expect(res.body).toEqual({
      code: 'internal_error',
      status: 500,
      title: 'Internal Server Error',
      type: 'about:blank',
    });
    expect(res.text).not.toContain('hunter2');
  });

  it('returns the request id it was given, or a new one', async () => {
    app = await start();
    const http = request(app.getHttpServer());

    const given = await http.get('/health/live').set('X-Request-Id', 'req-1');
    const created = await http.get('/health/live');

    expect(given.headers['x-request-id']).toBe('req-1');
    expect(created.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('writes JSON log lines that carry the request id', async () => {
    app = await start();
    const lines: string[] = [];
    const write = jest
      .spyOn(process.stdout, 'write')
      .mockImplementation((chunk) => {
        lines.push(String(chunk));
        return true;
      });

    await request(app.getHttpServer())
      .get('/api/v1/probe/log')
      .set('X-Request-Id', 'req-2');
    write.mockRestore();

    const entry = lines
      .flatMap((chunk) => chunk.split('\n'))
      .filter(Boolean)
      .map((line) => JSON.parse(line))
      .find((line) => line.message === 'probe called');
    expect(entry).toMatchObject({ context: 'Probe', requestId: 'req-2' });
  });

  it('serves the API documentation outside production only', async () => {
    app = await start('staging');
    await request(app.getHttpServer()).get('/api/docs').expect(200);
    await app.close();

    app = await start('production');
    await request(app.getHttpServer()).get('/api/docs').expect(404);
  });
});
