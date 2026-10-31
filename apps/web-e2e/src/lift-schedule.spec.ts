// @traces 151-FR-006 151-FR-007 151-FR-011 151-FR-012 151-FR-013 151-FR-018
import { expect, type Page } from '@playwright/test';

import { headers, ready, signIn } from './accounts.js';
import { bucharestDay } from './bucharest-day.js';
import { test } from './fixtures.js';
import { keepSeededLanguage } from './seeded-language.js';

// @seeded: Service Auto Militari schedules its lifts; its receptionist sees
// today's lift schedule on Panou and may block time on a lift.
const RECEPTIONIST = 'receptie-militari@example.test';
const QUARTER = 15 * 60_000;

interface Schedule {
  days: { day: string; open: { from: string; to: string }[] }[];
  hoursSet: boolean;
}

async function signedIn(page: Page) {
  await keepSeededLanguage(page);
  await ready(page, '/ro');
  await page
    .getByRole('banner')
    .getByRole('button', { exact: true, name: 'Autentificare' })
    .click();
  await signIn(page, RECEPTIONIST);
  await expect(page).toHaveURL('/app/garage');
}

const minutes = (time: string) => {
  const [hh, mm] = time.split(':').map(Number);
  return hh * 60 + mm;
};

// Whether the next hour sits on today's axis (the opening hours rounded out
// to whole hours, 8 to 18 when none are set).
function onAxis(schedule: Schedule, day: string, now: Date) {
  const open = schedule.days.find((d) => d.day === day)?.open ?? [];
  const [start, end] = schedule.hoursSet
    ? [
        Math.floor(Math.min(...open.map((o) => minutes(o.from))) / 60) * 60,
        Math.ceil(Math.max(...open.map((o) => minutes(o.to))) / 60) * 60,
      ]
    : [8 * 60, 18 * 60];
  const wall = new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    hourCycle: 'h23',
    minute: '2-digit',
    timeZone: 'Europe/Bucharest',
  }).format(now);
  const at = minutes(wall);
  return (
    (open.length > 0 || !schedule.hoursSet) && at >= start && at + 60 <= end
  );
}

test.describe('today’s lift schedule on Panou @seeded', () => {
  test('draws one row per lift, and a lift block made elsewhere arrives within seconds', async ({
    page,
    request,
  }) => {
    const auth = await headers(request, RECEPTIONIST);
    const me = await request.get('/api/v1/me', { headers: auth });
    const { garageId } = (await me.json()) as { garageId: string };
    const day = bucharestDay(0);
    const read = await request.get(
      `/api/v1/garages/${garageId}/schedule?from=${day}&to=${day}`,
      { headers: auth },
    );
    expect(read.ok(), await read.text()).toBe(true);
    const schedule = (await read.json()) as Schedule & { liftCount: number };

    await page.setViewportSize({ height: 900, width: 1440 });
    await signedIn(page);
    const panel = page.locator('[data-lift-schedule]');
    await expect(panel).toHaveAttribute('data-state', /empty|drawn|closed/);
    await expect(panel.getByRole('heading', { level: 2 })).toHaveText(
      'Programul de azi, pe elevatoare',
    );
    await expect(panel.locator('[data-now]')).toHaveText(/^acum, \d{2}:\d{2}$/);
    const state = await panel.getAttribute('data-state');
    test.skip(state === 'closed', 'the seeded garage is closed today');
    await expect(panel.locator('[data-row^="lift:"]')).toHaveCount(
      Math.max(schedule.liftCount, 1),
      { timeout: 5_000 },
    );

    const now = new Date();
    test.skip(!onAxis(schedule, day, now), 'the next hour is off today’s axis');
    const startsAt = new Date(Math.ceil(now.getTime() / QUARTER) * QUARTER);
    const note = `Linia de azi ${now.getTime()}`;
    const made = await request.post(`/api/v1/garages/${garageId}/time-blocks`, {
      data: {
        endsAt: new Date(startsAt.getTime() + 60 * 60_000).toISOString(),
        lift: 1,
        note,
        startsAt: startsAt.toISOString(),
      },
      headers: auth,
    });
    expect(made.ok(), await made.text()).toBe(true);
    const { id } = (await made.json()) as { id: string };
    try {
      const block = panel.locator('[data-row="lift:1"] [data-block]', {
        hasText: note,
      });
      await expect(block).toHaveAttribute('data-style', 'blocked', {
        timeout: 5_000,
      });
      await expect(block).toHaveAccessibleName(
        new RegExp(`^Blocat · ${note} · \\d{2}:\\d{2}, 60 min$`),
      );
    } finally {
      await request.delete(`/api/v1/garages/${garageId}/time-blocks/${id}`, {
        headers: auth,
      });
    }
  });

  test('scrolls sideways inside the panel at 375 px and never widens the page', async ({
    page,
  }) => {
    await page.setViewportSize({ height: 812, width: 375 });
    await signedIn(page);
    const panel = page.locator('[data-lift-schedule]');
    await expect(panel).toHaveAttribute('data-state', /empty|drawn|closed/);
    test.skip(
      (await panel.getAttribute('data-state')) === 'closed',
      'the seeded garage is closed today',
    );

    const scroller = panel.locator('.scroller');
    await expect(scroller).toBeVisible();
    const sizes = await page.evaluate(() => {
      const box = document.querySelector<HTMLElement>(
        '[data-lift-schedule] .scroller',
      );
      return {
        page: document.documentElement.scrollWidth,
        scroller: (box?.scrollWidth ?? 0) - (box?.clientWidth ?? 0),
        view: document.documentElement.clientWidth,
      };
    });
    expect(sizes.page).toBeLessThanOrEqual(sizes.view);
    expect(sizes.scroller).toBeGreaterThan(0);
  });
});
