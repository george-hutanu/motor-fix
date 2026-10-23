import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { checkInventory } from './observability-inventory.ts';

type Json = Record<string, unknown>;
type Panel = { title?: string; targets?: { expr?: string }[] };
type Rule = {
  uid: string;
  for: string;
  annotations: Record<string, string>;
  data: { model: { expr?: string; conditions?: Json[] } }[];
};
type Entry = {
  kind: string;
  name: string;
  alerts: string[] | 'none';
  dashboard: string;
  metric?: string;
  reason?: string;
};

const root = join(__dirname, '..');
const read = (path: string) =>
  JSON.parse(readFileSync(join(root, path), 'utf8'));

const worker = read(
  'infra/observability/grafana/dashboards/motorfix-worker.json',
) as { panels: Panel[] };
const rules = (
  read('infra/observability/alerts/worker.json') as {
    groups: { rules: Rule[] }[];
  }
).groups.flatMap((g) => g.rules);
const inventory = read('infra/observability/inventory.json') as {
  entries: Entry[];
};
const entry = (kind: string, name: string) =>
  inventory.entries.find((e) => e.kind === kind && e.name === name);
const text = JSON.stringify(inventory.entries);

// @traces 068-FR-016
describe('yearly documents observability', () => {
  it('the worker dashboard shows the cycle steps and the overdue count', () => {
    const panel = worker.panels.find((p) => p.title === 'Documente anuale');
    const exprs = (panel?.targets ?? []).map((t) => t.expr ?? '');

    expect(exprs).toEqual([
      expect.stringMatching(
        /sum by \(step\) \(increase\(motorfix_document_cycle_total\{deployment_environment="\$env"\}/,
      ),
      expect.stringMatching(
        /motorfix_documents_overdue\{deployment_environment="\$env"\}/,
      ),
    ]);
  });

  it('adds no alert of its own: a failed daily run already fires worker-jobs-failed', () => {
    const jobs = rules.find((r) => r.uid === 'worker-jobs-failed');

    expect(rules.map((r) => r.uid)).not.toContain('worker-compliance-failed');
    expect(jobs?.data[0]?.model.expr).toContain(
      'increase(motorfix_jobs_total{outcome="failed", queue!="verification-result"}[15m])',
    );
  });

  it('the inventory lists the step with its panel and the failed-jobs alert', () => {
    const queue = entry('queue', 'reminders');

    expect(queue?.alerts).toContain('worker-jobs-failed');
    expect(queue?.alerts).not.toContain('worker-compliance-failed');
    expect(queue?.reason).toMatch(/compliance step/);
    expect(queue?.reason).toMatch(/Documente anuale/);
  });

  it('the inventory lists the overdue gauge and the cycle counter', () => {
    expect(entry('product-counter', 'motorfix_documents_overdue')).toEqual(
      expect.objectContaining({
        alerts: ['worker-jobs-failed'],
        dashboard: 'motorfix-worker',
      }),
    );
    expect(entry('product-counter', 'motorfix_document_cycle_total')).toEqual(
      expect.objectContaining({ dashboard: 'motorfix-product' }),
    );
  });

  it('the inventory names the four routes', () => {
    const routes = [
      entry('endpoint', 'owner-legal-documents')?.metric,
      entry('endpoint', 'admin-legal-document-decision')?.metric,
    ].join(' ');

    for (const route of [
      '/api/v1/garages/:garageId/legal-documents',
      '/upload-url',
      '/api/v1/admin/legal-documents/:id/accept',
      '/refuse',
    ])
      expect(routes).toContain(route);
  });

  it('the inventory names the three notification types and the five events', () => {
    for (const name of [
      'DOCUMENT_DUE',
      'DOCUMENT_OVERDUE',
      'DOCUMENT_REFUSED',
      'document.due',
      'document.overdue',
      'document.uploaded',
      'document.accepted',
      'document.refused',
    ])
      expect([name, text.includes(name)]).toEqual([name, true]);
  });

  it('the inventory check passes', () => {
    expect(checkInventory(root)).toEqual([]);
  });
});
