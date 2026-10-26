// @traces 091-FR-015
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

type Entry = { kind: string; name: string; source: string; reason?: string };

const inventory = JSON.parse(
  readFileSync(
    join(__dirname, '..', 'infra/observability/inventory.json'),
    'utf8',
  ),
) as { entries: Entry[] };

describe('the oil service in the observability inventory', () => {
  const reminders = inventory.entries.find(
    (e) =>
      e.kind === 'queue' &&
      e.source === 'libs/domain/src/cars/reminders/reminders.module.ts',
  );

  it('names the odometer_reading table with the cars module and SERVICE_DUE under the reminders job', () => {
    expect(reminders?.reason).toContain('`odometer_reading` table');
    expect(reminders?.reason).toContain("cars module's");
    expect(reminders?.reason).toContain('SERVICE_DUE');
  });
});
