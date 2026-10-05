import { TestBed } from '@angular/core/testing';
import type { LiveMessage } from '@motor-fix/contracts';
import {
  type NotificationDto,
  NotificationsService,
} from '@motor-fix/data-access';
import { Overlays } from '@motor-fix/overlays';
import { Subject } from 'rxjs';

import { Bell, BellStore } from './bell';
import { Live } from './live';

jest.mock('@motor-fix/ui-cockpit', () => ({
  ...jest.requireActual('@motor-fix/ui-cockpit'),
  toast: jest.fn(),
}));

const READ_AT = '2026-10-05T09:00:00.000Z';

const row = (id: string, overrides: Partial<NotificationDto> = {}) =>
  ({
    at: '2026-10-05T08:00:00.000Z',
    id,
    kind: 'TEST_MESSAGE',
    readAt: null,
    subjectId: null,
    text: `Text ${id}`,
    ...overrides,
  }) as NotificationDto;

let api: {
  bellControllerList: jest.Mock;
  bellControllerRead: jest.Mock;
  bellControllerReadAll: jest.Mock;
  bellControllerUnreadCount: jest.Mock;
};
let events: Subject<LiveMessage>;

function setup(count: number, items: NotificationDto[]) {
  api = {
    bellControllerList: jest.fn(async () => ({ items, nextCursor: null })),
    bellControllerRead: jest.fn(async ({ id }: { id: string }) =>
      row(id, { readAt: READ_AT }),
    ),
    bellControllerReadAll: jest.fn(async () => undefined),
    bellControllerUnreadCount: jest.fn(async () => ({ count })),
  };
  events = new Subject();
  TestBed.configureTestingModule({
    providers: [
      { provide: NotificationsService, useValue: api },
      { provide: Live, useValue: { events } },
      { provide: Overlays, useValue: { open: jest.fn() } },
    ],
  });
}

async function settle(fixture: {
  detectChanges(): void;
  whenStable(): Promise<unknown>;
}) {
  for (let i = 0; i < 4; i++) {
    fixture.detectChanges();
    await fixture.whenStable();
  }
}

async function render(count: number, items: NotificationDto[]) {
  setup(count, items);
  const fixture = TestBed.createComponent(Bell);
  await settle(fixture);
  const element = fixture.nativeElement as HTMLElement;
  const store = fixture.debugElement.injector.get(BellStore);
  await store.load();
  return { element, fixture, store };
}

const badge = (element: HTMLElement) =>
  element.querySelector('.badge')?.textContent?.trim() ?? null;

const echo = (id = 'a') =>
  events.next({
    at: '2026-10-05T10:00:00.000Z',
    id,
    kind: 'notification.read',
  });

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  let reject: (reason: unknown) => void = () => undefined;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, reject, resolve };
}

afterEach(() => TestBed.resetTestingModule());

describe('BellStore badge after a read in this tab', () => {
  it('shows the count of the later request when the echo reload answers after the read reload', async () => {
    const { fixture, store } = await render(3, [row('a'), row('b'), row('c')]);
    const first = deferred<{ count: number }>();
    api.bellControllerUnreadCount
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce({ count: 2 });

    echo('b');
    await settle(fixture);
    await store.read('a');
    first.resolve({ count: 3 });
    await settle(fixture);

    expect(store.count()).toBe(2);
  });

  it('shows the answer reload count when the echo reload answers a stale higher count last', async () => {
    const { fixture, store } = await render(2, [row('a'), row('b')]);
    const echoed = deferred<{ count: number }>();
    api.bellControllerRead.mockResolvedValue(row('a', { readAt: READ_AT }));
    api.bellControllerUnreadCount
      .mockReturnValueOnce(echoed.promise)
      .mockResolvedValueOnce({ count: 1 });

    const reading = store.read('a');
    echo('a');
    await reading;
    echoed.resolve({ count: 2 });
    await settle(fixture);

    expect(store.count()).toBe(1);
  });

  it('shows the server count when the echo reload is still in flight as the read is answered', async () => {
    const { fixture, store } = await render(2, [row('a'), row('b')]);
    const answer = deferred<NotificationDto>();
    const echoed = deferred<{ count: number }>();
    api.bellControllerRead.mockReturnValue(answer.promise);
    api.bellControllerUnreadCount
      .mockReturnValueOnce(echoed.promise)
      .mockResolvedValueOnce({ count: 1 });

    const reading = store.read('a');
    echo('a');
    await settle(fixture);
    answer.resolve(row('a', { readAt: READ_AT }));
    await reading;
    echoed.resolve({ count: 1 });
    await settle(fixture);

    expect(store.count()).toBe(1);
  });

  it('hides the badge when the server counts none after the last read', async () => {
    const { element, fixture, store } = await render(1, [row('a')]);
    api.bellControllerUnreadCount.mockResolvedValue({ count: 0 });

    await store.read('a');
    await settle(fixture);

    expect(store.count()).toBe(0);
    expect(badge(element)).toBeNull();
  });

  it('never lowers the badge below zero when the count fails and none was shown', async () => {
    const { element, fixture, store } = await render(0, [row('a')]);
    api.bellControllerUnreadCount.mockRejectedValue(new Error('offline'));

    await store.read('a');
    await settle(fixture);

    expect(store.count()).toBe(0);
    expect(badge(element)).toBeNull();
  });

  it('lowers the badge by exactly one, not below zero, across repeated failed reads', async () => {
    const { store } = await render(1, [row('a'), row('b'), row('c')]);
    api.bellControllerUnreadCount.mockRejectedValue(new Error('offline'));

    await store.read('a');
    await store.read('b');
    await store.read('c');

    expect(store.count()).toBe(0);
  });

  it('lowers the badge once for two taps on the same row when the count fails', async () => {
    const { store } = await render(2, [row('a'), row('b')]);
    api.bellControllerUnreadCount.mockRejectedValue(new Error('offline'));

    await Promise.all([store.read('a'), store.read('a')]);

    expect(store.count()).toBe(1);
  });

  it('shows the last server count for two reads answered together', async () => {
    const { store } = await render(3, [row('a'), row('b'), row('c')]);
    api.bellControllerUnreadCount
      .mockResolvedValueOnce({ count: 2 })
      .mockResolvedValueOnce({ count: 1 });

    await Promise.all([store.read('a'), store.read('b')]);

    expect(store.count()).toBe(1);
  });

  it('keeps the badge and asks for no count when the read fails', async () => {
    const { element, fixture, store } = await render(2, [row('a'), row('b')]);
    api.bellControllerUnreadCount.mockClear();
    api.bellControllerRead.mockRejectedValue(new Error('offline'));

    await store.read('a');
    await settle(fixture);

    expect(store.count()).toBe(2);
    expect(badge(element)).toBe('2');
    expect(store.items()[0].readAt).toBeNull();
    expect(api.bellControllerUnreadCount).not.toHaveBeenCalled();
  });

  it('shows the server count for a read whose row is not loaded', async () => {
    const { store } = await render(2, [row('a')]);
    api.bellControllerUnreadCount.mockResolvedValue({ count: 1 });

    await store.read('elsewhere');

    expect(store.count()).toBe(1);
  });

  it('asks for the count once after the read when no echo arrives', async () => {
    const { store } = await render(2, [row('a'), row('b')]);
    api.bellControllerUnreadCount.mockClear();
    api.bellControllerUnreadCount.mockResolvedValue({ count: 1 });

    await store.read('a');

    expect(api.bellControllerUnreadCount).toHaveBeenCalledTimes(1);
  });

  it('shows the answer count after the echo reload fails and the read reload succeeds', async () => {
    const { fixture, store } = await render(3, [row('a'), row('b'), row('c')]);
    api.bellControllerUnreadCount
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ count: 2 });

    echo('a');
    await settle(fixture);
    await store.read('a');
    await settle(fixture);

    expect(store.count()).toBe(2);
  });
});
