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
const answer = (panels: DashboardPanelDto[], role = 'garage') =>
  ({ panels, role, updatedAt: null }) as DashboardLayoutDto;

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
}
function deferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => undefined;
  let reject: (error: unknown) => void = () => undefined;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, reject, resolve };
}

function setup({
  roles = ['garage'],
  read = async () => answer(all()),
  save = async ({ body }: { body: { panels: DashboardPanelDto[] } }) =>
    answer(body.panels),
  platform = 'browser',
}: {
  roles?: string[];
  read?: (params: { role: string }) => Promise<DashboardLayoutDto>;
  save?: (params: {
    role: string;
    body: { panels: DashboardPanelDto[] };
  }) => Promise<DashboardLayoutDto>;
  platform?: string;
} = {}) {
  const live = fakeLive();
  const api = {
    dashboardLayoutsControllerRead: jest.fn(read),
    dashboardLayoutsControllerSave: jest.fn(save),
  };
  const me = signal({ role: roles[0], roles } as unknown as MeDto);
  TestBed.configureTestingModule({
    providers: [
      { provide: PLATFORM_ID, useValue: platform },
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

// @traces 011-FR-002
describe('which layout the garage person reads', () => {
  it.each([
    [['garage'], 'garage'],
    [['mechanic', 'receptionist'], 'receptionist'],
    [['driver', 'mechanic'], 'mechanic'],
    [['mechanic', 'garage', 'receptionist'], 'garage'],
  ])('reads the first garage role of %j: %s', async (roles, role) => {
    const { api, layout, settle } = setup({ roles });
    await settle();

    expect(layout.role()).toBe(role);
    expect(api.dashboardLayoutsControllerRead).toHaveBeenCalledWith({ role });
  });

  it('reads and saves nothing without a garage role', async () => {
    const { api, layout, settle } = setup({ roles: ['driver'] });
    await settle();

    expect(layout.role()).toBeNull();
    expect(await layout.toggle('kpi', false)).toBe(false);
    expect(api.dashboardLayoutsControllerRead).not.toHaveBeenCalled();
    expect(api.dashboardLayoutsControllerSave).not.toHaveBeenCalled();
  });

  it('reads nothing on the server render', async () => {
    const { api, layout, settle } = setup({ platform: 'server' });
    await settle();

    expect(api.dashboardLayoutsControllerRead).not.toHaveBeenCalled();
    expect(layout.ready()).toBe(false);
  });

  it('is not ready until the read answers', async () => {
    const pending = deferred<DashboardLayoutDto>();
    const { layout, settle } = setup({ read: () => pending.promise });
    await settle();
    expect(layout.ready()).toBe(false);

    pending.resolve(answer(all(['sched'])));
    await settle();
    expect(layout.ready()).toBe(true);
    expect([...layout.hidden()]).toEqual(['sched']);
  });

  it('draws the default after a failed read', async () => {
    const { layout, settle } = setup({
      read: () => Promise.reject(new Error('down')),
    });
    await settle();

    expect(layout.ready()).toBe(true);
    expect(layout.server()).toBeNull();
    expect(layout.hidden().size).toBe(0);
  });
});

// @traces 011-FR-006
// @traces 011-FR-013
describe('switching a section', () => {
  it('hides it before the server answers and saves the whole layout in order', async () => {
    const saved = deferred<DashboardLayoutDto>();
    const { api, layout, settle } = setup({
      read: async () => answer([...all(['brands'])].reverse()),
      save: () => saved.promise,
    });
    await settle();

    const result = layout.toggle('sched', false);
    expect(layout.hidden().has('sched')).toBe(true);
    expect(api.dashboardLayoutsControllerSave).toHaveBeenCalledWith({
      body: { panels: [...all(['brands', 'sched'])].reverse() },
      role: 'garage',
    });

    saved.resolve(answer(all(['brands', 'sched'])));
    expect(await result).toBe(true);
    await settle();
    expect([...layout.hidden()].sort()).toEqual(['brands', 'sched']);
  });

  it('saves only the switched key after a failed read', async () => {
    const { api, layout, settle } = setup({
      read: () => Promise.reject(new Error('down')),
    });
    await settle();

    await layout.toggle('reviews', false);

    expect(api.dashboardLayoutsControllerSave).toHaveBeenCalledWith({
      body: { panels: [{ key: 'reviews', visible: false }] },
      role: 'garage',
    });
  });

  it('drops a read that was out when the switch was made', async () => {
    const reads = [async () => answer(all()), () => stale.promise];
    const stale = deferred<DashboardLayoutDto>();
    const { layout, live, settle } = setup({
      read: () => (reads.shift() as () => Promise<DashboardLayoutDto>)(),
    });
    await settle();

    live.emit('dashboard_layout.updated', 'account-1');
    await settle();
    await layout.toggle('sched', false);
    stale.resolve(answer(all()));
    await settle();

    expect([...layout.hidden()]).toEqual(['sched']);
  });

  it('sends every pending switch with the next save', async () => {
    const first = deferred<DashboardLayoutDto>();
    const saves = [
      () => first.promise,
      async () => answer(all(['kpi', 'load'])),
    ];
    const { api, layout, settle } = setup({
      save: () => (saves.shift() as () => Promise<DashboardLayoutDto>)(),
    });
    await settle();

    void layout.toggle('kpi', false);
    await layout.toggle('load', false);

    expect(api.dashboardLayoutsControllerSave).toHaveBeenLastCalledWith({
      body: { panels: all(['kpi', 'load']) },
      role: 'garage',
    });
    first.resolve(answer(all(['kpi'])));
  });

  it('drops the switch and answers false when the save fails', async () => {
    const { layout, settle } = setup({
      read: async () => answer(all(['funnel'])),
      save: () => Promise.reject(new Error('500')),
    });
    await settle();

    expect(await layout.toggle('funnel', true)).toBe(false);
    expect([...layout.hidden()]).toEqual(['funnel']);
    expect(layout.pending().size).toBe(0);
  });

  it('answers true for a failed save whose switch a later save kept', async () => {
    const first = deferred<DashboardLayoutDto>();
    const saves = [
      () => first.promise,
      async () => answer(all(['kpi', 'load'])),
    ];
    const { layout, settle } = setup({
      save: () => (saves.shift() as () => Promise<DashboardLayoutDto>)(),
    });
    await settle();

    const kpi = layout.toggle('kpi', false);
    await layout.toggle('load', false);
    first.reject(new Error('500'));

    expect(await kpi).toBe(true);
    expect([...layout.hidden()].sort()).toEqual(['kpi', 'load']);
  });

  it('sends nothing for a section whose save is pending', async () => {
    const saved = deferred<DashboardLayoutDto>();
    const { api, layout, settle } = setup({ save: () => saved.promise });
    await settle();

    void layout.toggle('kpi', false);
    expect(await layout.toggle('kpi', true)).toBe(true);
    expect(api.dashboardLayoutsControllerSave).toHaveBeenCalledTimes(1);
    saved.resolve(answer(all(['kpi'])));
  });
});

// @traces 011-FR-009
describe('a change made elsewhere', () => {
  it('re-reads on the layout event', async () => {
    let panels = all();
    const { api, layout, live, settle } = setup({
      read: async () => answer(panels),
    });
    await settle();

    panels = all(['req']);
    live.emit('dashboard_layout.updated', 'account-1');
    await settle();

    expect(api.dashboardLayoutsControllerRead).toHaveBeenCalledTimes(2);
    expect([...layout.hidden()]).toEqual(['req']);
  });

  it('re-reads on a resync', async () => {
    const { api, live, settle } = setup();
    await settle();

    live.resync.next();
    await settle();

    expect(api.dashboardLayoutsControllerRead).toHaveBeenCalledTimes(2);
  });

  it('ignores the event while a save is pending, and the save answer wins', async () => {
    const saved = deferred<DashboardLayoutDto>();
    const { api, layout, live, settle } = setup({ save: () => saved.promise });
    await settle();

    const result = layout.toggle('sched', false);
    live.emit('dashboard_layout.updated', 'account-1');
    await settle();
    expect(api.dashboardLayoutsControllerRead).toHaveBeenCalledTimes(1);

    saved.resolve(answer(all(['sched'])));
    await result;
    await settle();
    expect([...layout.hidden()]).toEqual(['sched']);
  });

  it('keeps the layout when a re-read fails', async () => {
    let fail = false;
    const { layout, live, settle } = setup({
      read: () =>
        fail
          ? Promise.reject(new Error('down'))
          : Promise.resolve(answer(all(['kpi']))),
    });
    await settle();

    fail = true;
    live.resync.next();
    await settle();

    expect([...layout.hidden()]).toEqual(['kpi']);
  });
});
