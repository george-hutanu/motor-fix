import { PLATFORM_ID, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  type DashboardLayoutDto,
  DashboardLayoutsService,
  type DashboardPanelDto,
  type MeDto,
} from '@motor-fix/data-access';

import { GarageLayout } from './garage-layout';
import { fakeLive, wait } from './garage-requests/garage-requests.testing';
import { Live } from './live';
import { Session } from './session';

const KEYS = [
  'kpi',
  'now',
  'req',
  'load',
  'sched',
  'funnel',
  'brands',
  'reviews',
];
const all = (hidden: readonly string[] = []): DashboardPanelDto[] =>
  KEYS.map((key) => ({ key, visible: !hidden.includes(key) }));
const answer = (panels: DashboardPanelDto[]) =>
  ({ panels, role: 'garage', updatedAt: null }) as DashboardLayoutDto;

type Save = (params: {
  role: string;
  body: { panels: DashboardPanelDto[] };
}) => Promise<DashboardLayoutDto>;

function setup({
  read = async () => answer(all()),
  save = async ({ body }) => answer(body.panels),
}: {
  read?: () => Promise<DashboardLayoutDto>;
  save?: Save;
} = {}) {
  const live = fakeLive();
  const api = {
    dashboardLayoutsControllerRead: jest.fn(read),
    dashboardLayoutsControllerSave: jest.fn(save),
  };
  const me = signal({ role: 'garage', roles: ['garage'] } as unknown as MeDto);
  TestBed.configureTestingModule({
    providers: [
      { provide: PLATFORM_ID, useValue: 'browser' },
      { provide: Live, useValue: live },
      { provide: Session, useValue: { current: me, shown: me } },
      { provide: DashboardLayoutsService, useValue: api },
    ],
  });
  const layout = TestBed.inject(GarageLayout);
  const settle = async () => {
    for (let i = 0; i < 4; i++) {
      TestBed.tick();
      await wait(0);
    }
  };
  return { api, layout, live, settle };
}

// @traces 011-FR-006
describe('switching a section, hostile cases', () => {
  it('does not send a key outside the eight', async () => {
    const { api, layout, settle } = setup();
    await settle();

    await layout.toggle('bogus', false);

    const calls = api.dashboardLayoutsControllerSave.mock.calls;
    for (const [params] of calls) {
      expect(params.body.panels.map((p) => p.key)).toEqual(KEYS);
    }
    expect(layout.hidden().has('bogus')).toBe(false);
  });

  it('answers false and restores the section when the save throws synchronously', async () => {
    const { layout, settle } = setup({
      save: () => {
        throw new Error('boom');
      },
    });
    await settle();

    expect(await layout.toggle('sched', false)).toBe(false);
    expect(layout.hidden().has('sched')).toBe(false);
    expect(layout.pending().size).toBe(0);
  });

  it('keeps a hidden key the server holds for a section the person cannot see', async () => {
    const stored = [...all(), { key: 'legacy', visible: false }];
    const { api, layout, settle } = setup({
      read: async () => answer(stored),
    });
    await settle();

    await layout.toggle('kpi', false);

    expect(
      api.dashboardLayoutsControllerSave.mock.calls[0][0].body.panels,
    ).toEqual(
      stored.map((p) => (p.key === 'kpi' ? { ...p, visible: false } : p)),
    );
  });

  it('shows the same state after switching a hidden section off again', async () => {
    const { layout, settle } = setup({
      read: async () => answer(all(['sched'])),
    });
    await settle();

    expect(await layout.toggle('sched', false)).toBe(true);
    await settle();
    expect([...layout.hidden()]).toEqual(['sched']);
  });

  it('keeps a failed first switch that the overlapping second save carried', async () => {
    let n = 0;
    const { layout, settle } = setup({
      save: async ({ body }) => {
        n += 1;
        if (n === 1) {
          await wait(5);
          throw new Error('down');
        }
        return answer(body.panels);
      },
    });
    await settle();

    const first = layout.toggle('sched', false);
    const second = layout.toggle('brands', false);
    expect(await first).toBe(true);
    expect(await second).toBe(true);
    await settle();

    expect([...layout.hidden()].sort()).toEqual(['brands', 'sched']);
    expect(layout.pending().size).toBe(0);
  });

  it('hides nothing and is ready when the server answers an empty layout', async () => {
    const { layout, settle } = setup({ read: async () => answer([]) });
    await settle();

    expect(layout.ready()).toBe(true);
    expect(layout.hidden().size).toBe(0);
  });

  it('survives a thousand switches in a row without leaking pending state', async () => {
    const { layout, settle } = setup();
    await settle();

    for (let i = 0; i < 1000; i++) {
      await layout.toggle('kpi', i % 2 === 1);
    }
    await settle();

    expect(layout.pending().size).toBe(0);
    expect(layout.hidden().has('kpi')).toBe(false);
  });
});

// @traces 011-FR-009
describe('a change made elsewhere, hostile cases', () => {
  it('follows a re-read after the first read failed', async () => {
    let calls = 0;
    const { layout, live, settle } = setup({
      read: async () => {
        calls += 1;
        if (calls === 1) throw new Error('down');
        return answer(all(['funnel']));
      },
    });
    await settle();
    expect(layout.server()).toBeNull();

    live.emit('dashboard_layout.updated' as never);
    await settle();

    expect([...layout.hidden()]).toEqual(['funnel']);
  });

  it('re-reads again after a save settles and a later event arrives', async () => {
    const { api, layout, live, settle } = setup();
    await settle();
    await layout.toggle('kpi', false);
    await settle();
    const before = api.dashboardLayoutsControllerRead.mock.calls.length;

    live.emit('dashboard_layout.updated' as never);
    await settle();

    expect(api.dashboardLayoutsControllerRead.mock.calls.length).toBe(
      before + 1,
    );
  });

  it('ignores unrelated events', async () => {
    const { api, live, settle } = setup();
    await settle();
    const before = api.dashboardLayoutsControllerRead.mock.calls.length;

    live.emit('request.updated' as never);
    await settle();

    expect(api.dashboardLayoutsControllerRead.mock.calls.length).toBe(before);
  });
});
