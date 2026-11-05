import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

import type { Page } from '@playwright/test';

// The one place the end-to-end specs load axe-core from. Each spec keeps its
// own rules and filters and passes them through.

type Violation = {
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

// Runs axe on the page once its entry animations have ended: `context` is what
// to scan (the whole document when left out, or axe's own `{ include,
// exclude }`), `options` are axe's run options (`runOnly`, `rules`,
// `resultTypes`). The scanner is added to the page the first time. A card
// still rising in (mf-rise starts at opacity 0) blends its text into the
// background, so axe would measure a contrast the settled page never shows;
// every finite running animation is let finish first (an endless one, such as
// a spinner, is not waited for).
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
      await Promise.all(
        document
          .getAnimations()
          .filter(
            (a) =>
              a.playState === 'running' &&
              Number.isFinite(Number(a.effect?.getComputedTiming().endTime)),
          )
          .map((a) => a.finished.catch(() => undefined)),
      );
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
