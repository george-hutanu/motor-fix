import type { Instrumentation } from '@opentelemetry/instrumentation';

import type { Service } from './start';

const health = (path: string | undefined) =>
  path?.startsWith('/health/') ?? false;

// A static file (`/main-AB12CD34.js`, `/icons/192.png`): its last segment has
// an extension, which no page route does.
const staticFile = (url: string | undefined) =>
  /\.[a-z0-9]+$/i.test((url ?? '').split(/[?#]/)[0] ?? '');

// What is traced: incoming and outgoing HTTP (http and fetch), Redis
// commands inside a request or job, and Prisma queries. Nothing for the file
// system, DNS or sockets. The web server has no database or Redis, and its
// static files and health probes are not traced. Loaded only when telemetry
// is on.
export function instrumentations(service?: Service): Instrumentation[] {
  const { HttpInstrumentation } =
    require('@opentelemetry/instrumentation-http') as typeof import('@opentelemetry/instrumentation-http');
  const { UndiciInstrumentation } =
    require('@opentelemetry/instrumentation-undici') as typeof import('@opentelemetry/instrumentation-undici');
  const { IORedisInstrumentation } =
    require('@opentelemetry/instrumentation-ioredis') as typeof import('@opentelemetry/instrumentation-ioredis');
  const { RuntimeNodeInstrumentation } =
    require('@opentelemetry/instrumentation-runtime-node') as typeof import('@opentelemetry/instrumentation-runtime-node');
  const { PrismaInstrumentation } =
    require('@prisma/instrumentation') as typeof import('@prisma/instrumentation');
  if (service === 'web') {
    return [
      new HttpInstrumentation({
        ignoreIncomingRequestHook: (req) =>
          health(req.url) || staticFile(req.url),
      }),
      new UndiciInstrumentation({
        ignoreRequestHook: (request) => health(request.path),
      }),
      new RuntimeNodeInstrumentation({ monitoringPrecision: 5_000 }),
    ];
  }
  return [
    new HttpInstrumentation({
      ignoreIncomingRequestHook: (req) => health(req.url),
    }),
    new UndiciInstrumentation(),
    new IORedisInstrumentation({
      requireParentSpan: true,
    }),
    new PrismaInstrumentation({
      ignoreSpanTypes: [
        'prisma:client:compile',
        'prisma:client:serialize',
        'prisma:client:connect',
      ],
    }),
    new RuntimeNodeInstrumentation({ monitoringPrecision: 5_000 }),
  ];
}
