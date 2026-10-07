import type { Instrumentation } from '@opentelemetry/instrumentation';

// What is traced: incoming and outgoing HTTP (http and fetch), Redis
// commands inside a request or job, and Prisma queries. Nothing for the file
// system, DNS or sockets. Loaded only when telemetry is on.
export function instrumentations(): Instrumentation[] {
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
  return [
    new HttpInstrumentation({
      ignoreIncomingRequestHook: (req) =>
        req.url?.startsWith('/health/') ?? false,
    }),
    new UndiciInstrumentation(),
    new IORedisInstrumentation({
      dbStatementSerializer: (command) => command,
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
