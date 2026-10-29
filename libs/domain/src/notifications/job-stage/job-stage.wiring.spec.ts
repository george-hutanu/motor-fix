import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { JOB_STAGE_CONSUMER, JOB_STAGE_QUEUE } from './job-stage.fan-out';

interface InventoryEntry {
  kind: string;
  name: string;
  source: string;
}

const root = join(__dirname, '../../../../..');
const json = (path: string) =>
  JSON.parse(readFileSync(join(root, path), 'utf8'));

// @traces 277-FR-007
describe('the tracker keeps its done wording', () => {
  it.each([
    ['ro', 'Mașina e gata. Poți veni după ea.'],
    ['en', 'Your car is ready. You can come and pick it up.'],
  ])('%s still invites the driver to collect the car', (language, text) => {
    const raw = readFileSync(
      join(root, `libs/i18n/src/driver/${language}.json`),
      'utf8',
    );
    expect(raw).toContain(JSON.stringify(text));
  });
});

// @traces 277-FR-008
describe('the job-stage queue is observed', () => {
  it('is listed in the inventory like booking-confirmed', () => {
    const { entries } = json('infra/observability/inventory.json') as {
      entries: InventoryEntry[];
    };
    const entry = entries.find(
      (e) => e.kind === 'queue' && e.name === JOB_STAGE_QUEUE,
    );
    expect(entry).toMatchObject({
      alerts: [
        'worker-queue-backlog',
        'worker-queue-growing',
        'worker-jobs-failed',
      ],
      dashboard: 'motorfix-queues',
      story: 'ST-277',
    });
    expect(existsSync(join(root, entry?.source ?? 'missing'))).toBe(true);
  });

  it('listens to started and done only', () => {
    expect(JOB_STAGE_CONSUMER.queue).toBe(JOB_STAGE_QUEUE);
    expect([...JOB_STAGE_CONSUMER.kinds]).toEqual(['job.started', 'job.done']);
  });
});
