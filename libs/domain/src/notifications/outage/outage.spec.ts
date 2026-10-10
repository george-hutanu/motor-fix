import { readAlerts } from './outage';

const firing = {
  endsAt: '0001-01-01T00:00:00Z',
  fingerprint: '5f1a2b3c4d5e6f70',
  labels: { alertname: 'outage', outage: 'true', service: 'web' },
  startsAt: '2026-10-10T03:04:05Z',
  status: 'firing',
};

const resolved = {
  ...firing,
  endsAt: '2026-10-10T03:09:00Z',
  status: 'resolved',
};

// @traces 251-FR-006 251-FR-007
describe('reading a Grafana alert payload', () => {
  it('reads a firing outage alert as the service being down since it started', () => {
    expect(readAlerts({ alerts: [firing] })).toEqual([
      {
        outage: {
          at: '2026-10-10T03:04:05.000Z',
          eventId: 'outage:5f1a2b3c4d5e6f70:2026-10-10T03:04:05Z:down',
          fingerprint: '5f1a2b3c4d5e6f70',
          service: 'web',
          state: 'down',
        },
      },
    ]);
  });

  it('reads a resolved outage alert as the service back when it ended', () => {
    expect(readAlerts({ alerts: [resolved] })).toEqual([
      {
        outage: {
          at: '2026-10-10T03:09:00.000Z',
          eventId: 'outage:5f1a2b3c4d5e6f70:2026-10-10T03:04:05Z:back',
          fingerprint: '5f1a2b3c4d5e6f70',
          service: 'web',
          state: 'back',
        },
      },
    ]);
  });

  it('gives a later outage of the same check its own event id', () => {
    const [first] = readAlerts({ alerts: [firing] }) ?? [];
    const [later] =
      readAlerts({
        alerts: [{ ...firing, startsAt: '2026-10-11T08:00:00Z' }],
      }) ?? [];
    expect(first).toHaveProperty('outage.eventId');
    expect(later).toHaveProperty('outage.eventId');
    expect((later as { outage: { eventId: string } }).outage.eventId).not.toBe(
      (first as { outage: { eventId: string } }).outage.eventId,
    );
  });

  it.each([
    ['no outage label', { ...firing, labels: { service: 'web' } }],
    [
      'an outage label that is not "true"',
      { ...firing, labels: { outage: true, service: 'web' } },
    ],
  ])('skips an alert with %s', (_label, alert) => {
    expect(readAlerts({ alerts: [alert] })).toEqual([
      { skipped: 'not_outage' },
    ]);
  });

  it.each([
    ['no fingerprint', { ...firing, fingerprint: undefined }],
    ['an unreadable start', { ...firing, startsAt: 'yesterday' }],
    ['an unreadable end once resolved', { ...resolved, endsAt: 'later' }],
    [
      'a status other than firing or resolved',
      { ...firing, status: 'pending' },
    ],
    ['no status', { ...firing, status: undefined }],
    [
      'a status named after an object property',
      { ...firing, status: 'toString' },
    ],
  ])('skips an outage alert with %s', (_label, alert) => {
    expect(readAlerts({ alerts: [alert] })).toEqual([{ skipped: 'malformed' }]);
  });

  it('names an unlabelled service unknown and cuts a long one to 40 characters', () => {
    const [unnamed, long] =
      readAlerts({
        alerts: [
          { ...firing, labels: { outage: 'true' } },
          { ...firing, labels: { outage: 'true', service: 'x'.repeat(60) } },
        ],
      }) ?? [];
    expect(unnamed).toHaveProperty('outage.service', 'unknown');
    expect(long).toHaveProperty('outage.service', 'x'.repeat(40));
  });

  it('reads every alert of the payload in order', () => {
    const api = {
      ...firing,
      fingerprint: 'aa',
      labels: { outage: 'true', service: 'api' },
    };
    const read = readAlerts({ alerts: [firing, api, { labels: {} }] });
    expect(read).toHaveLength(3);
    expect(read?.[1]).toHaveProperty('outage.service', 'api');
    expect(read?.[2]).toEqual({ skipped: 'not_outage' });
  });

  it.each([
    ['no body', undefined],
    ['a body that is not an object', 'hello'],
    ['no alerts', { status: 'firing' }],
    ['alerts that are not a list', { alerts: { status: 'firing' } }],
  ])('refuses %s', (_label, body) => {
    expect(readAlerts(body)).toBeNull();
  });
});
