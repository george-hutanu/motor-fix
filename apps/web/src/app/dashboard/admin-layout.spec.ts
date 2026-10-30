import { PLATFORM_ID, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  type DashboardLayoutDto,
  DashboardLayoutsService,
  type DashboardPanelDto,
  type MeDto,
} from '@motor-fix/data-access';

import { ADMIN_KEYS, AdminLayout } from './admin-layout';
import { fakeLive, wait } from './garage-requests/garage-requests.testing';
import { Live } from './live';
import { Session } from './session';

const KEYS = ['numbers', 'verification', 'growth', 'demand', 'log'];
const all = (
  hidden: readonly string[] = [],
  keys: readonly string[] = KEYS,
): DashboardPanelDto[] =>
  keys.map((key) => ({ key, visible: !hidden.includes(key) }));
const answer = (panels: DashboardPanelDto[]) =>
  ({ panels, role: 'admin', updatedAt: null }) as DashboardLayoutDto;
const order = (layout: AdminLayout) =>
  (layout.shown() ?? []).map((panel) => panel.key);
const hidden = (layout: AdminLayout) =>
  (layout.shown() ?? []).filter((p) => !p.visible).map((p) => p.key);

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

type Save = (params: {
  role: string;
  body: { panels: DashboardPanelDto[] };
}) => Promise<DashboardLayoutDto>;

function setup({
  roles = ['admin'],
  read = async () => answer(all()),
  save = async ({ body }) => answer(body.panels),
  reset = async () => answer(all()),
  platform = 'browser',
}: {
  roles?: string[];
  read?: (params: { role: string }) => Promise<DashboardLayoutDto>;
  save?: Save;
  reset?: (params: { role: string }) => Promise<DashboardLayoutDto>;
  platform?: string;
} = {}) {
  const live = fakeLive();
  const api = {
    dashboardLayoutsControllerRead: jest.fn(read),
    dashboardLayoutsControllerReset: jest.fn(reset),
    dashboardLayoutsControllerSave: jest.fn(save),
  };
  const me = signal({
    id: 'admin-1',
    role: roles[0],
    roles,
  } as unknown as MeDto);
  TestBed.configureTestingModule({
    providers: [
      { provide: PLATFORM_ID, useValue: platform },
      { provide: Live, useValue: live },
      { provide: Session, useValue: { current: me, shown: me } },
      { provide: DashboardLayoutsService, useValue: api },
    ],
  });
  const layout = TestBed.inject(AdminLayout);
  const settle = async () => {
    for (let i = 0; i < 4; i++) {
      TestBed.tick();
      await wait(0);
    }
  };
  return { api, layout, live, me, settle };
}

// @traces 1391-admin-dashboard-customise-FR-010
describe('reading the admin layout', () => {
  it('reads the admin layout once in the browser', async () => {
    const { api, layout, settle } = setup({
      read: async () => answer(all(['growth'])),
    });
    await settle();

    expect(api.dashboardLayoutsControllerRead).toHaveBeenCalledTimes(1);
    expect(api.dashboardLayoutsControllerRead).toHaveBeenCalledWith({
      role: 'admin',
    });
    expect(layout.ready()).toBe(true);
    expect(hidden(layout)).toEqual(['growth']);
  });

  it('is not ready and draws nothing until the read answers', async () => {
    const pending = deferred<DashboardLayoutDto>();
    const { layout, settle } = setup({ read: () => pending.promise });
    await settle();
    expect(layout.ready()).toBe(false);
    expect(layout.shown()).toBeNull();

    pending.resolve(answer([...all()].reverse()));
    await settle();
    expect(layout.ready()).toBe(true);
    expect(order(layout)).toEqual([...KEYS].reverse());
  });

  it('reads nothing on the server render', async () => {
    const { api, layout, settle } = setup({ platform: 'server' });
    await settle();

    expect(api.dashboardLayoutsControllerRead).not.toHaveBeenCalled();
    expect(layout.ready()).toBe(false);
  });

  it('reads and saves nothing without the admin role', async () => {
    const { api, layout, settle } = setup({ roles: ['driver'] });
    await settle();

    expect(await layout.toggle('log', false)).toBe(false);
    expect(api.dashboardLayoutsControllerRead).not.toHaveBeenCalled();
    expect(api.dashboardLayoutsControllerSave).not.toHaveBeenCalled();
  });

  it('draws the default, every section on, after a failed read', async () => {
    const { layout, settle } = setup({
      read: () => Promise.reject(new Error('down')),
    });
    await settle();

    expect(layout.ready()).toBe(true);
    expect(layout.server()).toBeNull();
    expect(layout.shown()).toEqual(all());
    expect(ADMIN_KEYS).toEqual(KEYS);
  });

  it('replaces the default with a later read', async () => {
    let fail = true;
    const { layout, live, settle } = setup({
      read: () =>
        fail
          ? Promise.reject(new Error('down'))
          : Promise.resolve(answer(all(['log']))),
    });
    await settle();

    fail = false;
    live.resync.next();
    await settle();

    expect(hidden(layout)).toEqual(['log']);
  });

  it('reads again for another account', async () => {
    const { api, me, settle } = setup();
    await settle();

    me.set({
      id: 'admin-2',
      role: 'admin',
      roles: ['admin'],
    } as unknown as MeDto);
    await settle();

    expect(api.dashboardLayoutsControllerRead).toHaveBeenCalledTimes(2);
  });
});

// @traces 1391-admin-dashboard-customise-FR-004 1391-admin-dashboard-customise-FR-009
describe('switching a section', () => {
  it('hides it at once and saves the whole layout in order', async () => {
    const saved = deferred<DashboardLayoutDto>();
    const { api, layout, settle } = setup({
      read: async () => answer([...all()].reverse()),
      save: () => saved.promise,
    });
    await settle();

    const result = layout.toggle('growth', false);
    expect(hidden(layout)).toEqual(['growth']);
    expect(layout.pending().has('growth')).toBe(true);
    expect(api.dashboardLayoutsControllerSave).toHaveBeenCalledWith({
      body: { panels: [...all(['growth'])].reverse() },
      role: 'admin',
    });

    saved.resolve(answer([...all(['growth'])].reverse()));
    expect(await result).toBe(true);
    await settle();
    expect(layout.pending().size).toBe(0);
    expect(hidden(layout)).toEqual(['growth']);
  });

  it('saves the default with the change after a failed read', async () => {
    const { api, layout, settle } = setup({
      read: () => Promise.reject(new Error('down')),
    });
    await settle();

    await layout.toggle('demand', false);

    expect(api.dashboardLayoutsControllerSave).toHaveBeenCalledWith({
      body: { panels: all(['demand']) },
      role: 'admin',
    });
  });

  it('puts the switch back and answers false when the save fails', async () => {
    const { layout, settle } = setup({
      read: async () => answer(all(['log'])),
      save: () => Promise.reject(new Error('500')),
    });
    await settle();

    expect(await layout.toggle('log', true)).toBe(false);
    await settle();
    expect(hidden(layout)).toEqual(['log']);
    expect(layout.pending().size).toBe(0);
  });

  it('sends nothing for a section whose switch save is out', async () => {
    const saved = deferred<DashboardLayoutDto>();
    const { api, layout, settle } = setup({ save: () => saved.promise });
    await settle();

    void layout.toggle('numbers', false);
    expect(await layout.toggle('numbers', true)).toBe(true);
    expect(api.dashboardLayoutsControllerSave).toHaveBeenCalledTimes(1);
    saved.resolve(answer(all(['numbers'])));
  });
});

// @traces 1391-admin-dashboard-customise-FR-005 1391-admin-dashboard-customise-FR-009
describe('moving a section', () => {
  it('swaps the two sections at once and saves the whole layout', async () => {
    const saved = deferred<DashboardLayoutDto>();
    const { api, layout, settle } = setup({
      read: async () => answer(all(['growth'])),
      save: () => saved.promise,
    });
    await settle();

    const moved = ['numbers', 'verification', 'growth', 'log', 'demand'];
    const result = layout.swap('log', 'demand');
    expect(order(layout)).toEqual(moved);
    expect(api.dashboardLayoutsControllerSave).toHaveBeenCalledWith({
      body: { panels: all(['growth'], moved) },
      role: 'admin',
    });

    saved.resolve(answer(all(['growth'], moved)));
    expect(await result).toBe(true);
    await settle();
    expect(order(layout)).toEqual(moved);
    expect(hidden(layout)).toEqual(['growth']);
  });

  it('keeps a key it does not know in its place', async () => {
    const keys = ['numbers', 'reported', 'verification', 'growth', 'demand'];
    const { api, layout, settle } = setup({
      read: async () => answer(all([], keys)),
    });
    await settle();

    await layout.swap('verification', 'numbers');

    expect(api.dashboardLayoutsControllerSave).toHaveBeenCalledWith({
      body: {
        panels: all(
          [],
          ['verification', 'reported', 'numbers', 'growth', 'demand'],
        ),
      },
      role: 'admin',
    });
  });

  it('keeps every press while a save is out and sends the order as shown', async () => {
    const first = deferred<DashboardLayoutDto>();
    const saves: Save[] = [
      () => first.promise,
      async ({ body }) => answer(body.panels),
    ];
    const { api, layout, settle } = setup({
      save: (params) => (saves.shift() as Save)(params),
    });
    await settle();

    void layout.swap('log', 'demand');
    await layout.swap('log', 'growth');

    const moved = ['numbers', 'verification', 'log', 'growth', 'demand'];
    expect(api.dashboardLayoutsControllerSave).toHaveBeenLastCalledWith({
      body: { panels: all([], moved) },
      role: 'admin',
    });
    first.resolve(
      answer(all([], ['numbers', 'verification', 'growth', 'log', 'demand'])),
    );
    await settle();
    expect(order(layout)).toEqual(moved);
  });

  it('puts the row back in the server order when the move fails', async () => {
    const { layout, settle } = setup({
      save: () => Promise.reject(new Error('500')),
    });
    await settle();

    expect(await layout.swap('numbers', 'verification')).toBe(false);
    await settle();
    expect(order(layout)).toEqual(KEYS);
  });

  it('keeps the earlier answer when the later move fails', async () => {
    const second = deferred<DashboardLayoutDto>();
    const saves: Save[] = [
      async ({ body }) => answer(body.panels),
      () => second.promise,
    ];
    const { layout, settle } = setup({
      save: (params) => (saves.shift() as Save)(params),
    });
    await settle();

    const one = layout.swap('log', 'demand');
    const two = layout.swap('numbers', 'verification');
    expect(await one).toBe(true);
    second.reject(new Error('500'));
    expect(await two).toBe(false);
    await settle();
    expect(order(layout)).toEqual([
      'numbers',
      'verification',
      'growth',
      'log',
      'demand',
    ]);
  });

  it('answers true for a failed move a later save carried', async () => {
    const first = deferred<DashboardLayoutDto>();
    const saves: Save[] = [
      () => first.promise,
      async ({ body }) => answer(body.panels),
    ];
    const { layout, settle } = setup({
      save: (params) => (saves.shift() as Save)(params),
    });
    await settle();

    const one = layout.swap('log', 'demand');
    await layout.toggle('growth', false);
    first.reject(new Error('500'));

    expect(await one).toBe(true);
    await settle();
    expect(order(layout)).toEqual([
      'numbers',
      'verification',
      'growth',
      'log',
      'demand',
    ]);
  });

  it('drops a late answer of an older save', async () => {
    const first = deferred<DashboardLayoutDto>();
    const saves: Save[] = [
      () => first.promise,
      async ({ body }) => answer(body.panels),
    ];
    const { layout, settle } = setup({
      save: (params) => (saves.shift() as Save)(params),
    });
    await settle();

    void layout.swap('log', 'demand');
    await layout.swap('numbers', 'verification');
    first.resolve(
      answer(all([], ['numbers', 'verification', 'growth', 'log', 'demand'])),
    );
    await settle();

    expect(order(layout)).toEqual([
      'verification',
      'numbers',
      'growth',
      'log',
      'demand',
    ]);
  });
});

// @traces 1391-admin-dashboard-customise-FR-006 1391-admin-dashboard-customise-FR-009
describe('going back to the default', () => {
  it('shows every section in the default order at once and resets on the server', async () => {
    const answered = deferred<DashboardLayoutDto>();
    const { api, layout, settle } = setup({
      read: async () =>
        answer(
          all(
            ['growth'],
            ['log', 'numbers', 'verification', 'growth', 'demand'],
          ),
        ),
      reset: () => answered.promise,
    });
    await settle();

    const result = layout.reset();
    expect(layout.shown()).toEqual(all());
    expect(api.dashboardLayoutsControllerReset).toHaveBeenCalledWith({
      role: 'admin',
    });
    expect(api.dashboardLayoutsControllerSave).not.toHaveBeenCalled();

    answered.resolve(answer(all()));
    expect(await result).toBe(true);
    await settle();
    expect(layout.shown()).toEqual(all());
  });

  it('puts the layout back as it was when the reset fails', async () => {
    const before = all(
      ['growth'],
      ['log', 'numbers', 'verification', 'growth', 'demand'],
    );
    const { layout, settle } = setup({
      read: async () => answer(before),
      reset: () => Promise.reject(new Error('500')),
    });
    await settle();

    expect(await layout.reset()).toBe(false);
    await settle();
    expect(layout.shown()).toEqual(before);
  });
});

// @traces 1391-admin-dashboard-customise-FR-011
describe('a change made elsewhere', () => {
  it('re-reads on the layout event', async () => {
    let panels = all();
    const { api, layout, live, settle } = setup({
      read: async () => answer(panels),
    });
    await settle();

    panels = all(['demand']);
    live.emit('dashboard_layout.updated', 'admin-1');
    await settle();

    expect(api.dashboardLayoutsControllerRead).toHaveBeenCalledTimes(2);
    expect(hidden(layout)).toEqual(['demand']);
  });

  it('re-reads on a resync', async () => {
    const { api, live, settle } = setup();
    await settle();

    live.resync.next();
    await settle();

    expect(api.dashboardLayoutsControllerRead).toHaveBeenCalledTimes(2);
  });

  it('ignores the event while a save is out, and the save answer wins', async () => {
    const saved = deferred<DashboardLayoutDto>();
    const { api, layout, live, settle } = setup({ save: () => saved.promise });
    await settle();

    const result = layout.swap('log', 'demand');
    live.emit('dashboard_layout.updated', 'admin-1');
    await settle();
    expect(api.dashboardLayoutsControllerRead).toHaveBeenCalledTimes(1);

    const moved = ['numbers', 'verification', 'growth', 'log', 'demand'];
    saved.resolve(answer(all([], moved)));
    await result;
    await settle();
    expect(order(layout)).toEqual(moved);
  });

  it('drops a read that was out when a change was made', async () => {
    const stale = deferred<DashboardLayoutDto>();
    const reads = [async () => answer(all()), () => stale.promise];
    const { layout, live, settle } = setup({
      read: () => (reads.shift() as () => Promise<DashboardLayoutDto>)(),
    });
    await settle();

    live.emit('dashboard_layout.updated', 'admin-1');
    await settle();
    await layout.toggle('log', false);
    stale.resolve(answer(all()));
    await settle();

    expect(hidden(layout)).toEqual(['log']);
  });

  it('keeps the layout when a re-read fails', async () => {
    let fail = false;
    const { layout, live, settle } = setup({
      read: () =>
        fail
          ? Promise.reject(new Error('down'))
          : Promise.resolve(answer(all(['numbers']))),
    });
    await settle();

    fail = true;
    live.resync.next();
    await settle();

    expect(hidden(layout)).toEqual(['numbers']);
  });
});
