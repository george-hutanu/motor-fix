// @traces 151-FR-006 151-FR-007 151-FR-011 151-FR-012 151-FR-013 151-FR-018
import {
  type APIRequestContext,
  type APIResponse,
  expect,
  type Page,
} from '@playwright/test';

import { headers, ready, signIn } from './accounts.js';
import { bucharestDay } from './bucharest-day.js';
import { test } from './fixtures.js';
import { keepSeededLanguage } from './seeded-language.js';

// @seeded: Service Auto Militari schedules its lifts; its receptionist sees
// today's lift schedule on Panou and may block time on a lift.
const RECEPTIONIST = 'receptie-militari@example.test';

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

// The first whole hour of today's axis (the opening hours rounded out to whole
// hours, 8:00 while none are set); null on a closed day.
function axisStart(schedule: Schedule, day: string): number | null {
  if (!schedule.hoursSet) return 8 * 60;
  const open = schedule.days.find((d) => d.day === day)?.open ?? [];
  if (open.length === 0) return null;
  return Math.floor(Math.min(...open.map((o) => minutes(o.from))) / 60) * 60;
}

// The last whole hour of today's axis (18:00 while no hours are set).
function axisEnd(schedule: Schedule, day: string): number {
  if (!schedule.hoursSet) return 18 * 60;
  const open = schedule.days.find((d) => d.day === day)?.open ?? [];
  return Math.ceil(Math.max(...open.map((o) => minutes(o.to))) / 60) * 60;
}

const wallClock = (at: Date) =>
  new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    hourCycle: 'h23',
    minute: '2-digit',
    timeZone: 'Europe/Bucharest',
  }).format(at);

// A Bucharest wall time of `day` as an instant.
function bucharest(day: string, at: number): Date {
  const noon = new Date(`${day}T12:00:00Z`);
  const offset = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Bucharest',
    timeZoneName: 'longOffset',
  })
    .formatToParts(noon)
    .find((part) => part.type === 'timeZoneName')
    ?.value.replace('GMT', '');
  const clock = `${String(Math.floor(at / 60)).padStart(2, '0')}:${String(at % 60).padStart(2, '0')}`;
  return new Date(`${day}T${clock}:00${offset || '+00:00'}`);
}

// Blocks lift 1 for at least an hour of today's axis that has not ended:
// from the next quarter hour while an hour fits before closing, else from the
// axis's last hour on to an hour after now (an ended interval is a 422); a
// 409 (a seeded booking holds the slot) tries the next quarter. Gives the
// block's length in minutes with the answer.
async function blockLiftOne(
  request: APIRequestContext,
  auth: Record<string, string>,
  slot: {
    day: string;
    end: number;
    garageId: string;
    note: string;
    now: number;
    start: number;
  },
): Promise<{ made: APIResponse; minutes: number }> {
  const QUARTER = 15 * 60_000;
  const soon = Math.ceil(slot.now / QUARTER) * QUARTER + 60 * 60_000;
  const quarter = Math.ceil(minutes(wallClock(new Date(slot.now))) / 15) * 15;
  let at =
    quarter < slot.start
      ? slot.start
      : quarter + 60 > slot.end
        ? Math.max(slot.start, slot.end - 60)
        : quarter;
  for (;;) {
    const startsAt = bucharest(slot.day, at);
    const endsAt = Math.max(startsAt.getTime() + 60 * 60_000, soon);
    const made = await request.post(
      `/api/v1/garages/${slot.garageId}/time-blocks`,
      {
        data: {
          endsAt: new Date(endsAt).toISOString(),
          lift: 1,
          note: slot.note,
          startsAt: startsAt.toISOString(),
        },
        headers: auth,
      },
    );
    at += 15;
    if (made.status() !== 409 || at >= slot.end)
      return {
        made,
        minutes: Math.round((endsAt - startsAt.getTime()) / 60_000),
      };
  }
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
    const start = axisStart(schedule, day);
    if (start === null) {
      // A closed day draws no rows, only its sentence.
      await expect(panel).toHaveAttribute('data-state', 'closed');
      await expect(panel.locator('[data-closed]')).toBeVisible();
      return;
    }
    await expect(panel.locator('[data-row^="lift:"]')).toHaveCount(
      Math.max(schedule.liftCount, 1),
      { timeout: 5_000 },
    );

    const now = Date.now();
    const note = `Linia de azi ${now}`;
    const { made, minutes: long } = await blockLiftOne(request, auth, {
      day,
      end: axisEnd(schedule, day),
      garageId,
      note,
      now,
      start,
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
        new RegExp(`^Blocat · ${note} · \\d{2}:\\d{2}, ${long} min$`),
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
    const closed = (await panel.getAttribute('data-state')) === 'closed';

    // A closed day has no timeline to scroll; the page still never widens.
    await expect(panel.locator('.scroller')).toHaveCount(closed ? 0 : 1);
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
    expect(sizes.scroller > 0).toBe(!closed);
  });
});
