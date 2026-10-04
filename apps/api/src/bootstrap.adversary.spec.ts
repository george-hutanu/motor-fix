import { readEnv } from '@motor-fix/contracts';
import {
  Body,
  Controller,
  Get,
  INestApplication,
  Logger,
  Param,
  Post,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Type } from 'class-transformer';
import { IsInt, IsObject, IsString, ValidateNested } from 'class-validator';
import request from 'supertest';

import { AppModule } from './app.module';
import { configureApp } from './bootstrap';

class InnerDto {
  @IsString()
  tag!: string;
}

class ThingDto {
  @IsString()
  name!: string;

  @IsInt()
  @Type(() => Number)
  count!: number;

  @IsObject()
  @ValidateNested()
  @Type(() => InnerDto)
  inner!: InnerDto;
}

@Controller('thing')
class ThingController {
  private readonly logger = new Logger('Thing');

  @Post()
  create(@Body() body: ThingDto) {
    return { count: body.count, kind: typeof body.count };
  }

  @Get('slow/:n')
  async slow(@Param('n') n: string) {
    await new Promise((resolve) => setTimeout(resolve, 20 - Number(n)));
    this.logger.log(`slow ${n}`);
    return {};
  }

  @Get('unavailable')
  unavailable() {
    throw new ServiceUnavailableException('queue is down');
  }

  @Get('throw-string')
  throwString() {
    throw 'a plain string';
  }

  @Get('throw-null')
  throwNull() {
    throw null;
  }

  @Get('throw-object')
  throwObject() {
    throw { password: 'hunter2', status: 418 };
  }
}

const env = {
  APP_ENV: 'test',
  DATABASE_URL:
    process.env['DATABASE_URL'] ?? 'postgresql://localhost:5432/postgres',
  REDIS_URL: process.env['REDIS_URL'] ?? 'redis://localhost:6379',
  RELEASE_SHA: 'abc123',
};

async function start(appEnv = 'test') {
  const config = readEnv(['DATABASE_URL', 'REDIS_URL'], {
    ...env,
    APP_ENV: appEnv,
  });
  const moduleRef = await Test.createTestingModule({
    controllers: [ThingController],
    imports: [AppModule.register(config)],
  }).compile();
  const app = moduleRef.createNestApplication({ bufferLogs: true });
  configureApp(app, config);
  await app.init();
  return app;
}

const valid = { count: 1, inner: { tag: 't' }, name: 'a' };

describe('api conventions under hostile requests', () => {
  let app: INestApplication;

  afterEach(() => app.close());

  it('names the unknown property in the problem detail', async () => {
    app = await start();

    const res = await request(app.getHttpServer())
      .post('/api/v1/thing')
      .send({ ...valid, foo: 1 });

    expect(res.status).toBe(400);
    expect(res.headers['content-type']).toContain('application/problem+json');
    expect(res.body).toMatchObject({
      code: 'validation_failed',
      status: 400,
      title: 'Bad Request',
      type: 'about:blank',
    });
    expect(res.body.detail).toContain('property foo should not exist');
  });

  it('refuses an unknown field nested inside a valid object', async () => {
    app = await start();

    const res = await request(app.getHttpServer())
      .post('/api/v1/thing')
      .send({ ...valid, inner: { extra: true, tag: 't' } });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('validation_failed');
  });

  it('transforms a numeric string to the DTO number type', async () => {
    app = await start();

    const res = await request(app.getHttpServer())
      .post('/api/v1/thing')
      .send({ ...valid, count: '7' });

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ count: 7, kind: 'number' });
  });

  it.each([
    ['a string where a number is', { ...valid, count: 'seven' }],
    ['null for a required field', { ...valid, name: null }],
    ['a number where a string is', { ...valid, name: 5 }],
    ['a missing nested object', { count: 1, name: 'a' }],
    ['an empty object', {}],
    ['a fractional integer', { ...valid, count: 1.5 }],
    ['an array instead of an object', [valid]],
  ])('answers 400 validation_failed for %s', async (_title, body) => {
    app = await start();

    const res = await request(app.getHttpServer())
      .post('/api/v1/thing')
      .send(body as object);

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('validation_failed');
  });

  it('answers 400 validation_failed for a body that is not sent at all', async () => {
    app = await start();

    const res = await request(app.getHttpServer()).post('/api/v1/thing');

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('validation_failed');
  });

  it('answers 400 as problem details for malformed JSON', async () => {
    app = await start();

    const res = await request(app.getHttpServer())
      .post('/api/v1/thing')
      .set('Content-Type', 'application/json')
      .send('{"name": ');

    expect(res.status).toBe(400);
    expect(res.headers['content-type']).toContain('application/problem+json');
    expect(res.body.code).toBe('validation_failed');
  });

  it('answers 400, not 500, for a body that tries to set __proto__', async () => {
    app = await start();

    const res = await request(app.getHttpServer())
      .post('/api/v1/thing')
      .set('Content-Type', 'application/json')
      .send(
        '{"name":"a","count":1,"inner":{"tag":"t"},"__proto__":{"admin":true}}',
      );

    expect(res.status).toBeLessThan(500);
  });

  it('answers 404 problem details for a wrong method on a real route', async () => {
    app = await start();

    const res = await request(app.getHttpServer()).delete('/api/v1/thing');

    expect(res.status).toBe(404);
    expect(res.headers['content-type']).toContain('application/problem+json');
    expect(res.body.code).toBe('not_found');
  });

  it('answers 404 problem details for a path outside the prefix', async () => {
    app = await start();

    const res = await request(app.getHttpServer()).get('/thing');

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('not_found');
  });

  it('answers a service-unavailable exception with its own code and 503', async () => {
    app = await start();

    const res = await request(app.getHttpServer()).get(
      '/api/v1/thing/unavailable',
    );

    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({
      code: 'service_unavailable',
      status: 503,
    });
  });

  it.each([
    'throw-string',
    'throw-null',
    'throw-object',
  ])('answers 500 internal_error with no detail when the route does %s', async (route) => {
    app = await start();

    const res = await request(app.getHttpServer()).get(
      `/api/v1/thing/${route}`,
    );

    expect(res.status).toBe(500);
    expect(res.headers['content-type']).toContain('application/problem+json');
    expect(res.body.code).toBe('internal_error');
    expect(res.body.detail).toBeUndefined();
    expect(res.body.stack).toBeUndefined();
    expect(res.text).not.toContain('hunter2');
  });

  describe('request id', () => {
    it('is present on a 404, a 400 and a 500', async () => {
      app = await start();
      const http = request(app.getHttpServer());

      const responses = [
        await http.get('/api/v1/nope'),
        await http.post('/api/v1/thing').send({}),
        await http.get('/api/v1/thing/throw-string'),
      ];

      for (const res of responses) {
        expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
      }
    });

    it('echoes the given id on an error response', async () => {
      app = await start();

      const res = await request(app.getHttpServer())
        .get('/api/v1/thing/throw-string')
        .set('X-Request-Id', 'abc-500');

      expect(res.headers['x-request-id']).toBe('abc-500');
    });

    it('creates a fresh id when the header is empty', async () => {
      app = await start();

      const res = await request(app.getHttpServer())
        .get('/health/live')
        .set('X-Request-Id', '');

      expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    });

    it('creates different ids for two requests without one', async () => {
      app = await start();
      const http = request(app.getHttpServer());

      const a = await http.get('/health/live');
      const b = await http.get('/health/live');

      expect(a.headers['x-request-id']).not.toBe(b.headers['x-request-id']);
    });

    it('does not reflect an absurdly long id back unbounded', async () => {
      app = await start();

      const res = await request(app.getHttpServer())
        .get('/health/live')
        .set('X-Request-Id', 'a'.repeat(7000));

      expect((res.headers['x-request-id'] ?? '').length).toBeLessThanOrEqual(
        256,
      );
    });

    it('keeps each request id on its own log lines under concurrency', async () => {
      app = await start();
      const lines: string[] = [];
      const write = jest
        .spyOn(process.stdout, 'write')
        .mockImplementation((chunk) => {
          lines.push(String(chunk));
          return true;
        });
      const http = request(app.getHttpServer());

      await Promise.all(
        Array.from({ length: 15 }, (_, n) =>
          http.get(`/api/v1/thing/slow/${n}`).set('X-Request-Id', `id-${n}`),
        ),
      );
      write.mockRestore();

      const entries = lines
        .flatMap((chunk) => chunk.split('\n'))
        .filter((line) => line.startsWith('{'))
        .map((line) => JSON.parse(line))
        .filter((line) => String(line.message).startsWith('slow '));
      expect(entries).toHaveLength(15);
      for (const entry of entries) {
        expect(entry.requestId).toBe(`id-${String(entry.message).slice(5)}`);
      }
    });
  });

  describe('api documentation', () => {
    it.each([
      'development',
      'test',
      'staging',
    ])('is served in %s', async (e) => {
      app = await start(e);

      await request(app.getHttpServer()).get('/api/docs').expect(200);
    });

    it('is not served in production under any of its paths', async () => {
      app = await start('production');
      const http = request(app.getHttpServer());

      for (const path of [
        '/api/docs',
        '/api/docs/',
        '/api/docs-json',
        '/api/docs/swagger-ui-init.js',
      ]) {
        const res = await http.get(path);
        expect([path, res.status]).toEqual([path, 404]);
      }
    });
  });

  it('keeps health outside the prefix in production too', async () => {
    app = await start('production');

    await request(app.getHttpServer())
      .get('/health/live')
      .expect(200, { status: 'ok' });
  });
});
