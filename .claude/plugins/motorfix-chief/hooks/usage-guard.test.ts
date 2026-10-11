import { expect, test } from 'claude-code/testing';

import { ok, stubs } from './lib/stubs.ts';

// @traces 1168-FR-011

const CHIEF = '/m/.git\n/m/.git\n';
const RESET = '2026-10-11T17:00:00Z';
const FABLE_OFF = ['node', '.claude/scripts/fable.mjs', 'off'];
const measure = (
  $,
  percentUsed: number,
  resetsAt = RESET,
  kind = 'five_hour',
) =>
  $.session.measure({
    changed: ['rateLimits'],
    context: {},
    rateLimits: [{ kind, percentUsed, resetsAt }],
  });

// Beneath the plugin: the engine's dialog, answering each ask with `label`
// (null: dismissed) and keeping the questions it was asked.
function dialog(on, label: string | null) {
  const asked: string[] = [];
  on('tool.call', { tool: 'AskUserQuestion' }, (_$, e) => {
    const q = e.questions[0].question;
    asked.push(q);
    if (label === null) return { deny: 'dismissed' };
    return { result: { answers: { [q]: label }, questions: e.questions } };
  });
  on('session.measure', (_$, e) => ({ changed: e.changed }));
  return asked;
}

const start = ($) =>
  $.session.start({ cwd: '/m', isInteractive: true, surface: 'terminal' });
const fableRuns = (s) =>
  s.runs.filter((r) => r.argv.join(' ') === FABLE_OFF.join(' '));

test('one warning at the first 80 % of a window; accepting runs fable.mjs off once', async ($, on) => {
  const s = stubs(on, { run: () => ok(CHIEF) });
  const asked = dialog(on, 'Remap fable to Opus');
  await start($);
  await measure($, 79);
  expect(asked).toEqual([]);
  await measure($, 80);
  await measure($, 93.5);
  expect(asked).toEqual([
    'The five_hour usage window is at 80 % (resets 2026-10-11T17:00:00Z). Remap fable to Opus with fable.mjs off?',
  ]);
  expect(fableRuns(s)).toHaveLength(1);
  expect((fableRuns(s)[0].init as { cwd: string }).cwd).toBe('/m');
  expect(s.store.get(`usage:five_hour:${RESET}`)).toEqual({
    answer: 'remap',
    percentUsed: 80,
  });
});

test('a new reset time or another window kind warns again', async ($, on) => {
  stubs(on, { run: () => ok(CHIEF) });
  const asked = dialog(on, 'Not now');
  await start($);
  await measure($, 85);
  await measure($, 85, '2026-10-11T22:00:00Z');
  await measure($, 81, RESET, 'seven_day');
  expect(asked).toHaveLength(3);
});

for (const [name, label] of [
  ['declining', 'Not now'],
  ['dismissing', null],
] as const) {
  test(`${name} runs nothing and is recorded as declined`, async ($, on) => {
    const s = stubs(on, { run: () => ok(CHIEF) });
    dialog(on, label);
    await start($);
    await measure($, 90);
    expect(fableRuns(s)).toEqual([]);
    expect(s.store.get(`usage:five_hour:${RESET}`)).toEqual({
      answer: 'declined',
      percentUsed: 90,
    });
  });
}
