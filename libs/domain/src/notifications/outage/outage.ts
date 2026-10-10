export interface Outage {
  service: string;
  state: 'down' | 'back';
  // When the check started failing (down) or passed again (back), ISO.
  at: string;
  // One per outage and state: a repeated webhook for it sends nothing.
  eventId: string;
  fingerprint: string;
}

export type ReadAlert =
  | { outage: Outage }
  | { skipped: 'not_outage' | 'malformed' };

const record = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const iso = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const time = Date.parse(value);
  return Number.isNaN(time) ? null : new Date(time).toISOString();
};

function readAlert(value: unknown): ReadAlert {
  const alert = record(value) ?? {};
  const labels = record(alert['labels']) ?? {};
  if (labels['outage'] !== 'true') return { skipped: 'not_outage' };
  const state = alert['status'] === 'firing' ? 'down' : 'back';
  const { fingerprint, startsAt } = alert;
  const started = iso(startsAt);
  const at = state === 'down' ? started : iso(alert['endsAt']);
  if (typeof fingerprint !== 'string' || !fingerprint || !started || !at) {
    return { skipped: 'malformed' };
  }
  const service = labels['service'];
  return {
    outage: {
      at,
      eventId: `outage:${fingerprint}:${startsAt}:${state}`,
      fingerprint,
      service:
        typeof service === 'string' && service
          ? service.slice(0, 40)
          : 'unknown',
      state,
    },
  };
}

// Grafana's alerting webhook body; null when it holds no list of alerts.
export function readAlerts(body: unknown): ReadAlert[] | null {
  const alerts = record(body)?.['alerts'];
  return Array.isArray(alerts) ? alerts.map(readAlert) : null;
}
