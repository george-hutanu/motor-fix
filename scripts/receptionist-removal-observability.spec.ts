// @traces 400-FR-006
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

type Entry = {
  alerts?: string[];
  dashboard?: string;
  kind: string;
  metric?: string;
  name: string;
  reason?: string;
  source: string;
  story?: string;
};

const inventory = JSON.parse(
  readFileSync(
    join(__dirname, '..', 'infra/observability/inventory.json'),
    'utf8',
  ),
) as { entries: Entry[] };

describe("a receptionist's removal in the observability inventory", () => {
  const entry = inventory.entries.find(
    (e) => e.kind === 'endpoint' && e.name === 'garage-members-remove',
  );

  it('lists the route under the API dashboard and alerts', () => {
    expect(entry).toMatchObject({
      alerts: ['api-error-rate', 'api-latency'],
      dashboard: 'motorfix-api',
      metric:
        'http.server.request.duration by http.route /api/v1/garages/:garageId/members/:accountId',
      source: 'libs/domain/src/garages/members/members.controller.ts',
      story: 'ST-400',
    });
  });

  it('names the audit entry, member.removed, STAFF_REMOVED and the owner_row refusal', () => {
    for (const part of [
      'member',
      'member.removed',
      'STAFF_REMOVED',
      'logged as an error',
      'owner_row',
    ]) {
      expect(entry?.reason).toContain(part);
    }
  });
});
