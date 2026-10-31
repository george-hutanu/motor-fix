import { PLATFORM_ID, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  type DashboardLayoutDto,
  DashboardLayoutsService,
  type DashboardPanelDto,
  type MeDto,
} from '@motor-fix/data-access';

import { AdminLayout } from './admin-layout';
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

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

type Save = (params: {
  role: string;
  body: { panels: DashboardPanelDto[] };
}) => Promise<DashboardLayoutDto>;

function setup({
  read = async () => answer(all()),
  save = async ({ body }) => answer(body.panels),
  reset = async () => answer(all()),
  roles = ['admin'],
}: {
  read?: () => Promise<DashboardLayoutDto>;
  save?: Save;
  reset?: () => Promise<DashboardLayoutDto>;
  roles?: string[];
} = {}) {
  const live = fakeLive();
  const api = {
    dashboardLayoutsControllerRead: jest.fn(read),
    dashboardLayoutsControllerReset: jest.fn(reset),
    dashboardLayoutsControllerSave: jest.fn(save),
  };
  const me = signal<MeDto | null>({
    id: 'admin-1',
    role: roles[0],
    roles,
  } as unknown as MeDto);
  TestBed.configureTestingModule({
    providers: [
      { provide: PLATFORM_ID, useValue: 'browser' },
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

// @traces 1391-FR-004 1391-FR-005 1391-FR-009 1391-FR-014
describe('the admin layout given keys it should not act on', () => {
  it('saves nothing for a key the web has no section for', async () => {
    const { api, layout, settle } = setup();
    await settle();

    await layout.toggle('constructor', false);
    await layout.toggle('__proto__', false);
    expect(api.dashboardLayoutsControllerSave).not.toHaveBeenCalled();
    expect(order(layout)).toEqual(KEYS);
  });

  it('saves nothing for a known key the server list lacks', async () => {
    const { api, layout, settle } = setup({
      read: async () => answer(all([], ['numbers', 'log'])),
    });
    await settle();

    await layout.toggle('demand', false);
    expect(api.dashboardLayoutsControllerSave).not.toHaveBeenCalled();
    expect(order(layout)).toEqual(['numbers', 'log']);
  });

  it('does not move a section onto itself', async () => {
    const { api, layout, settle } = setup();
    await settle();

    void layout.swap('growth', 'growth');
    await settle();

    expect(order(layout)).toEqual(KEYS);
    expect(hidden(layout)).toEqual([]);
    expect(layout.shown()).toHaveLength(5);
    expect(
      api.dashboardLayoutsControllerSave.mock.calls.every(
        ([call]) => call.body.panels.length === 5,
      ),
    ).toBe(true);
  });

  it('does not move a section past a key that is not in the list', async () => {
    const { api, layout, settle } = setup();
    await settle();

    expect(await layout.swap('numbers', 'nowhere')).toBe(false);
    expect(await layout.swap('nowhere', 'numbers')).toBe(false);
    expect(api.dashboardLayoutsControllerSave).not.toHaveBeenCalled();
    expect(order(layout)).toEqual(KEYS);
  });

  it('keeps keys the web does not know in every save', async () => {
    const keys = ['numbers', 'reported', 'verification', 'performance', 'log'];
    const { api, layout, settle } = setup({
      read: async () => answer(all(['reported'], keys)),
    });
    await settle();

    await layout.toggle('log', false);

    expect(api.dashboardLayoutsControllerSave).toHaveBeenCalledWith({
      body: { panels: all(['reported', 'log'], keys) },
      role: 'admin',
    });
  });
});

// @traces 1391-FR-004 1391-FR-009
describe('switching to the state a section already has', () => {
  it('leaves the layout as it was', async () => {
    const { layout, settle } = setup({
      read: async () => answer(all(['log'])),
    });
    await settle();

    await layout.toggle('log', false);
    await settle();

    expect(hidden(layout)).toEqual(['log']);
    expect(order(layout)).toEqual(KEYS);
  });
});

// @traces 1391-FR-010
describe('an answer the admin layout cannot use', () => {
  it('draws the default when the read answers without panels', async () => {
    const { layout, settle } = setup({
      read: async () => ({ role: 'admin' }) as unknown as DashboardLayoutDto,
    });
    await settle();

    expect(layout.ready()).toBe(true);
    expect(layout.shown()).toEqual(all());
  });

  it('draws the default when the read answers null', async () => {
    const { layout, settle } = setup({
      read: async () => null as unknown as DashboardLayoutDto,
    });
    await settle();

    expect(layout.ready()).toBe(true);
    expect(layout.shown()).toEqual(all());
  });
});

// @traces 1391-FR-010 1391-FR-011
describe('the admin layout when the account changes', () => {
  it('drops the read of the previous account when it answers late', async () => {
    const first = deferred<DashboardLayoutDto>();
    const reads = [() => first.promise, async () => answer(all(['demand']))];
    const { layout, me, settle } = setup({
      read: () => (reads.shift() as () => Promise<DashboardLayoutDto>)(),
    });
    await settle();

    me.set({
      id: 'admin-2',
      role: 'admin',
      roles: ['admin'],
    } as unknown as MeDto);
    await settle();
    first.resolve(answer(all(['numbers', 'log'])));
    await settle();

    expect(hidden(layout)).toEqual(['demand']);
  });

  it('saves nothing once nobody is signed in', async () => {
    const { api, layout, me, settle } = setup();
    await settle();

    me.set(null);
    await settle();

    expect(await layout.toggle('log', false)).toBe(false);
    expect(await layout.swap('numbers', 'verification')).toBe(false);
    expect(await layout.reset()).toBe(false);
    expect(api.dashboardLayoutsControllerSave).not.toHaveBeenCalled();
    expect(api.dashboardLayoutsControllerReset).not.toHaveBeenCalled();
  });

  it('does not read for a layout event when the account is not an admin', async () => {
    const { api, live, settle } = setup({ roles: ['garage'] });
    await settle();

    live.emit('dashboard_layout.updated', 'x');
    live.resync.next();
    await settle();

    expect(api.dashboardLayoutsControllerRead).not.toHaveBeenCalled();
  });
});

// @traces 1391-FR-005 1391-FR-009
describe('many quick moves', () => {
  it('ends with the order the last save carried and the one shown', async () => {
    const { api, layout, settle } = setup();
    await settle();

    const presses: Promise<boolean>[] = [];
    for (let i = 0; i < 20; i++) {
      presses.push(layout.swap('log', i % 2 ? 'demand' : 'growth'));
    }
    await Promise.all(presses);
    await settle();

    const calls = api.dashboardLayoutsControllerSave.mock.calls;
    const last = calls[calls.length - 1][0].body.panels.map((p) => p.key);
    expect(order(layout)).toEqual(last);
    expect([...order(layout)].sort()).toEqual([...KEYS].sort());
  });
});

// @traces 1391-FR-006
describe('going back to the default', () => {
  it('resets on the server even when the layout could not be read', async () => {
    const { api, layout, settle } = setup({
      read: () => Promise.reject(new Error('down')),
    });
    await settle();

    expect(await layout.reset()).toBe(true);
    expect(api.dashboardLayoutsControllerReset).toHaveBeenCalledWith({
      role: 'admin',
    });
    expect(layout.shown()).toEqual(all());
  });

  it('shows the default twice over when pressed twice', async () => {
    const { layout, settle } = setup({
      read: async () => answer(all(['log'], [...KEYS].reverse())),
    });
    await settle();

    await Promise.all([layout.reset(), layout.reset()]);
    await settle();

    expect(order(layout)).toEqual(KEYS);
    expect(hidden(layout)).toEqual([]);
  });

  it('answers with the server order when a late save answer arrives after the reset', async () => {
    const late = deferred<DashboardLayoutDto>();
    const { layout, settle } = setup({ save: () => late.promise });
    await settle();

    void layout.swap('log', 'demand');
    await layout.reset();
    late.resolve(
      answer(all([], ['numbers', 'verification', 'growth', 'log', 'demand'])),
    );
    await settle();

    expect(order(layout)).toEqual(KEYS);
  });
});
