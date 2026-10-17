import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

import type { Page } from '@playwright/test';

// The one place the end-to-end specs load axe-core from. Each spec keeps its
// own rules and filters and passes them through.

export type Violation = {
  id: string;
  impact?: string | null;
  nodes: Array<{ html: string; target: unknown[] }>;
};

type Axe = {
  run: (
    context: unknown,
    options: unknown,
  ) => Promise<{ violations: Violation[] }>;
};

const AXE = readFileSync(
  createRequire(import.meta.url).resolve('axe-core/axe.min.js'),
  'utf8',
);

// Runs axe on the page as it is now: `context` is what to scan (the whole
// document when left out, or axe's own `{ include, exclude }`), `options` are
// axe's run options (`runOnly`, `rules`, `resultTypes`). The scanner is added
// to the page the first time.
export async function violations(
  page: Page,
  options: Record<string, unknown> = {},
  context?: unknown,
): Promise<Violation[]> {
  const loaded = await page.evaluate(() => 'axe' in globalThis);
  if (!loaded) await page.evaluate(AXE);
  return page.evaluate(
    async ([options, context]) => {
      const axe = (globalThis as unknown as { axe: Axe }).axe;
      const result = await axe.run(context ?? document, options);
      return result.violations.map(({ id, impact, nodes }) => ({
        id,
        impact,
        nodes: nodes.map(({ html, target }) => ({ html, target })),
      }));
    },
    [options, context] as const,
  );
}
