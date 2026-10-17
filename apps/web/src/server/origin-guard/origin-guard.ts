import { metrics } from '@opentelemetry/api';
import { logs, SeverityNumber } from '@opentelemetry/api-logs';
import type { Express } from 'express';

// Railway's health check reaches the origin directly, without the CDN.
const PROBES = new Set(['/health/live', '/health/ready']);

// With secrets set, a request whose X-Origin-Secret is not one of them gets
// a bare 403 before anything else runs: only the CDN reaches the origin.
// With none, nothing is registered and every request goes on as before.
export function mountOriginGuard(app: Express, secrets: readonly string[]) {
  if (secrets.length === 0) return;
  app.use((req, res, next) => {
    const sent = req.get('x-origin-secret');
    if (PROBES.has(req.path) || (sent && secrets.includes(sent))) {
      next();
      return;
    }
    refused(`origin refused ${req.method} ${req.path}`);
    res.status(403).end();
  });
}

// The path is logged, never the value the request sent.
function refused(message: string) {
  metrics
    .getMeter('motorfix')
    .createCounter('motorfix_origin_refused_total', {
      description:
        'Requests the web origin refused for a missing or wrong CDN secret',
    })
    .add(1);
  console.warn(JSON.stringify({ level: 'warn', message }));
  logs.getLogger('motorfix').emit({
    body: message,
    severityNumber: SeverityNumber.WARN,
    severityText: 'WARN',
  });
}
