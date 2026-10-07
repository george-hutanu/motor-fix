import { readEnv, STORAGE_ENV } from '@motor-fix/contracts';
import { Public } from '@motor-fix/domain';
import { databaseTurn, PRISMA, S3TestStore } from '@motor-fix/domain/testing';
import {
  observeWorker,
  queueTelemetry,
  startTelemetry,
} from '@motor-fix/observability';
import { inMemory, patchForJest } from '@motor-fix/observability/testing';
import { Controller, Get, type INestApplication, Inject } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { SpanKind, SpanStatusCode } from '@opentelemetry/api';
import type { ReadableSpan } from '@opentelemetry/sdk-trace-node';
import { Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import request from 'supertest';

import { AppModule } from './app.module';
import { configureApp } from './bootstrap';

const env = {
  APP_ENV: 'staging',
  AUTH_TOKEN_SECRET: 'test-secret',
  DATABASE_URL:
    process.env['DATABASE_URL'] ?? 'postgresql://localhost:5432/postgres',
  OTEL_EXPORTER_OTLP_ENDPOINT: 'http://127.0.0.1:1',
  REDIS_URL: process.env['REDIS_URL'] ?? 'redis://localhost:6379',
} as const;

const memory = inMemory();
const started = startTelemetry('api', env, memory);
patchForJest();

const QUEUE = 'telemetry-probe';
const queue = new Queue(QUEUE, {
  connection: { url: env.REDIS_URL },
  telemetry: queueTelemetry(),
});
const handled: unknown[] = [];
const redis = new Redis(env.REDIS_URL);

@Controller('probe')
@Public()
class ProbeController {
  constructor(
    @Inject(PRISMA)
    private readonly prisma: {
      $queryRaw: (q: TemplateStringsArray) => Promise<unknown>;
    },
  ) {}

  @Get('trace/:id')
  async trace() {
    await this.prisma.$queryRaw`select 1`;
    await redis.get('telemetry-probe');
    await queue.add('probe', { kind: 'probe', n: 1 });
    return {};
  }

  @Get('boom')
  boom() {
    throw new Error('database unreachable');
  }
}

const store = new S3TestStore();
const turn = databaseTurn(env.DATABASE_URL);
let app: INestApplication;
let worker: Worker;

async function spans(): Promise<ReadableSpan[]> {
  await started?.flush();
  return memory.spanExporter.getFinishedSpans();
}

async function jobsDone(count: number) {
  for (let i = 0; i < 100 && handled.length < count; i++) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  await new Promise((resolve) => setTimeout(resolve, 50));
}

beforeAll(async () => {
  await turn.take();
  await store.start();
  const config = readEnv(
    ['DATABASE_URL', 'REDIS_URL', 'AUTH_TOKEN_SECRET', ...STORAGE_ENV],
    { ...env, ...store.env() },
  );
  const moduleRef = await Test.createTestingModule({
    controllers: [ProbeController],
    imports: [AppModule.register(config)],
  }).compile();
  app = moduleRef.createNestApplication({ bufferLogs: true });
  configureApp(app, config);
  await app.init();
  await queue.obliterate({ force: true });
  worker = new Worker(
    QUEUE,
    async (job) => {
      handled.push(job.data);
    },
    {
      connection: { maxRetriesPerRequest: null, url: env.REDIS_URL },
      telemetry: queueTelemetry(),
    },
  );
  observeWorker(worker);
}, 120_000);

afterAll(async () => {
  try {
    await worker?.close();
    await queue.close();
    redis.disconnect();
    await app?.close();
    await started?.shutdown();
    await store.stop();
  } finally {
    await turn.release();
  }
});

beforeEach(() => {
  memory.spanExporter.reset();
  handled.length = 0;
});

describe('telemetry in the API', () => {
  it('holds the request, its query, its Redis call and the job it queued in one trace', async () => {
    await request(app.getHttpServer()).get('/api/v1/probe/trace/7').expect(200);
    await jobsDone(1);

    const all = await spans();
    const server = all.find(
      (span) =>
        span.kind === SpanKind.SERVER &&
        span.name === 'GET /api/v1/probe/trace/:id',
    );
    expect(server).toBeDefined();
    const traceId = server?.spanContext().traceId;
    const inTrace = all.filter(
      (span) => span.spanContext().traceId === traceId,
    );
    const names = inTrace.map((span) => span.name);
    expect(names).toEqual(
      expect.arrayContaining([
        'prisma:client:operation',
        'get',
        `process ${QUEUE}`,
      ]),
    );
    const jobSpans = all.filter((span) => span.name === `process ${QUEUE}`);
    expect(
      jobSpans.every((span) => span.spanContext().traceId === traceId),
    ).toBe(true);
    expect(handled).toEqual([{ kind: 'probe', n: 1 }]);
  });

  it('starts a new trace for a job queued outside any request', async () => {
    await queue.add('probe', { kind: 'probe', n: 2 });
    await jobsDone(1);

    // The trace starts at the producer's `add`, which has no parent: no
    // request is there to join.
    const all = await spans();
    const add = all.find((span) => span.name === `add ${QUEUE}.probe`);
    const job = all.find((span) => span.name === `process ${QUEUE}`);
    expect(add?.parentSpanContext).toBeUndefined();
    expect(job?.spanContext().traceId).toBe(add?.spanContext().traceId);
    expect(all.some((span) => span.kind === SpanKind.SERVER)).toBe(false);
  });

  it('continues a well-formed incoming trace and starts afresh on a malformed one', async () => {
    const traceId = '0af7651916cd43dd8448eb211c80319c';
    await request(app.getHttpServer())
      .get('/api/v1/probe/trace/1')
      .set('traceparent', `00-${traceId}-b7ad6b7169203331-00`);
    await request(app.getHttpServer())
      .get('/api/v1/probe/trace/2')
      .set('traceparent', 'garbage');
    await jobsDone(2);

    const servers = (await spans()).filter(
      (span) => span.kind === SpanKind.SERVER,
    );
    expect(servers.map((span) => span.spanContext().traceId)).toEqual([
      traceId,
      expect.not.stringMatching(traceId),
    ]);
  });

  it('marks a request that fails on the server as an error, with the exception', async () => {
    const lines: string[] = [];
    const capture = (chunk: string | Uint8Array) => {
      lines.push(String(chunk));
      return true;
    };
    const out = jest.spyOn(process.stdout, 'write').mockImplementation(capture);
    const err = jest.spyOn(process.stderr, 'write').mockImplementation(capture);
    try {
      await request(app.getHttpServer()).get('/api/v1/probe/boom').expect(500);
    } finally {
      out.mockRestore();
      err.mockRestore();
    }

    const [span] = (await spans()).filter((s) => s.kind === SpanKind.SERVER);
    expect(span?.status.code).toBe(SpanStatusCode.ERROR);
    expect(span?.events.map((event) => event.name)).toContain('exception');
    const errors = lines
      .flatMap((line) => line.split('\n'))
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .filter((line) => line['level'] === 'error');
    expect(errors).toHaveLength(1);
    expect(errors[0]?.['trace_id']).toBe(span?.spanContext().traceId);
  });
});
