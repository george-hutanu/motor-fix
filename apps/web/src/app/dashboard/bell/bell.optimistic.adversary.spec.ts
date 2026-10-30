import { TestBed } from '@angular/core/testing';
import type { LiveMessage } from '@motor-fix/contracts';
import {
  type NotificationDto,
  NotificationsService,
} from '@motor-fix/data-access';
import { Overlays } from '@motor-fix/overlays';
import { toast } from '@motor-fix/ui-cockpit';
import { Subject } from 'rxjs';

import { Bell, BellStore } from './bell';
import { Live } from '../live';
import { Session } from '../session';

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
      { provide: Session, useValue: { token: () => 'access' } },
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

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  let reject: (reason: unknown) => void = () => undefined;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, reject, resolve };
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const tick = () => wait(0);
const ids = (store: BellStore) => store.items().map((n) => n.id);
const readAts = (store: BellStore) => store.items().map((n) => n.readAt);

beforeEach(() => jest.mocked(toast).mockClear());
afterEach(() => TestBed.resetTestingModule());

// @traces 1315-FR-003
// @traces 1315-FR-008
describe('BellStore read shows before the answer and rolls back when refused', () => {
  it('marks the row read and lowers the badge before the read answers', async () => {
    const { store } = await render(3, [row('a'), row('b'), row('c')]);
    const pending = deferred<NotificationDto>();
    api.bellControllerRead.mockImplementationOnce(() => pending.promise);

    const done = store.read('a');
    await tick();

    expect(store.items()[0].readAt).not.toBeNull();
    expect(store.count()).toBe(2);
    expect(api.bellControllerRead).toHaveBeenCalledTimes(1);
    pending.resolve(row('a', { readAt: READ_AT }));
    await done;
    expect(store.items()[0].readAt).toBe(READ_AT);
  });

  it('puts the row and the badge back and toasts once when the read is refused', async () => {
    const { store } = await render(3, [row('a'), row('b'), row('c')]);
    api.bellControllerRead.mockRejectedValueOnce(new Error('refused'));

    await store.read('a');

    expect(readAts(store)).toEqual([null, null, null]);
    expect(store.count()).toBe(3);
    expect(toast).toHaveBeenCalledTimes(1);
    expect(api.bellControllerRead).toHaveBeenCalledTimes(1);
  });

  it('does not raise the badge again when a newer count was shown while the refused read was out', async () => {
    const { store } = await render(3, [row('a'), row('b'), row('c')]);
    const pending = deferred<NotificationDto>();
    api.bellControllerRead.mockImplementationOnce(() => pending.promise);

    const done = store.read('a');
    await tick();
    api.bellControllerUnreadCount.mockResolvedValueOnce({ count: 1 });
    await store.refreshCount();
    expect(store.count()).toBe(1);
    pending.reject(new Error('refused'));
    await done;

    expect(store.count()).toBe(1);
    expect(readAts(store)[0]).toBeNull();
  });

  it('never leaves a negative badge when the refused read hits a badge already at zero', async () => {
    const { store } = await render(0, [row('a')]);
    api.bellControllerRead.mockRejectedValueOnce(new Error('refused'));

    await store.read('a');

    expect(store.count()).toBe(0);
    expect(readAts(store)).toEqual([null]);
  });

  it('keeps a row read that a live echo and reload marked read while the refused read was out', async () => {
    const { store } = await render(2, [row('a'), row('b')]);
    const pending = deferred<NotificationDto>();
    api.bellControllerRead.mockImplementationOnce(() => pending.promise);

    const done = store.read('a');
    await tick();
    api.bellControllerList.mockResolvedValueOnce({
      items: [row('a', { readAt: READ_AT }), row('b')],
      nextCursor: null,
    });
    events.next({ at: READ_AT, id: 'a', kind: 'notification.read' });
    await wait(20);
    pending.reject(new Error('refused'));
    await done;

    expect(store.items()[0].readAt).toBe(READ_AT);
  });

  it('rolls back on a 404 like any refusal', async () => {
    const { store } = await render(1, [row('a')]);
    api.bellControllerRead.mockRejectedValueOnce({ status: 404 });

    await store.read('a');

    expect(readAts(store)).toEqual([null]);
    expect(store.count()).toBe(1);
    expect(toast).toHaveBeenCalledTimes(1);
  });

  it('sends one write for two taps on the same row while it is out', async () => {
    const { store } = await render(2, [row('a'), row('b')]);
    const pending = deferred<NotificationDto>();
    api.bellControllerRead.mockImplementationOnce(() => pending.promise);

    const first = store.read('a');
    const second = store.read('a');
    pending.resolve(row('a', { readAt: READ_AT }));
    await Promise.all([first, second]);

    expect(api.bellControllerRead).toHaveBeenCalledTimes(1);
  });

  it('can read the row again after a refusal, with a fresh write', async () => {
    const { store } = await render(1, [row('a')]);
    api.bellControllerRead.mockRejectedValueOnce(new Error('refused'));
    await store.read('a');

    await store.read('a');

    expect(api.bellControllerRead).toHaveBeenCalledTimes(2);
    expect(store.items()[0].readAt).toBe(READ_AT);
  });

  it('ignores a read of an id that is not listed without lowering the badge below zero', async () => {
    const { store } = await render(0, [row('a')]);
    api.bellControllerRead.mockRejectedValueOnce(new Error('refused'));

    await store.read('zzz');

    expect(store.count()).toBe(0);
  });
});

// @traces 1315-FR-004
describe('BellStore readAll shows before the answer and rolls back when refused', () => {
  it('marks every row read and zeroes the badge before the call answers', async () => {
    const { store } = await render(2, [row('a'), row('b')]);
    const pending = deferred<undefined>();
    api.bellControllerReadAll.mockImplementationOnce(() => pending.promise);

    const done = store.readAll();
    await tick();

    expect(readAts(store).every((r) => r !== null)).toBe(true);
    expect(store.count()).toBe(0);
    expect(api.bellControllerReadAll).toHaveBeenCalledTimes(1);
    pending.resolve(undefined);
    await done;
  });

  it('gives every row its own readAt back, and the badge its count, when refused', async () => {
    const earlier = '2026-10-04T09:00:00.000Z';
    const { store } = await render(2, [
      row('a'),
      row('b', { readAt: earlier }),
      row('c'),
    ]);
    api.bellControllerReadAll.mockRejectedValueOnce(new Error('refused'));

    await store.readAll();

    expect(readAts(store)).toEqual([null, earlier, null]);
    expect(store.count()).toBe(2);
    expect(toast).toHaveBeenCalledTimes(1);
  });

  it('does not restore the badge over a newer count shown since the press', async () => {
    const { store } = await render(2, [row('a'), row('b')]);
    const pending = deferred<undefined>();
    api.bellControllerReadAll.mockImplementationOnce(() => pending.promise);

    const done = store.readAll();
    await tick();
    api.bellControllerUnreadCount.mockResolvedValueOnce({ count: 1 });
    await store.refreshCount();
    pending.reject(new Error('refused'));
    await done;

    expect(store.count()).toBe(1);
  });

  it('with nothing unread, leaves the rows and the badge as they are when refused', async () => {
    const { store } = await render(0, [row('a', { readAt: READ_AT })]);
    api.bellControllerReadAll.mockRejectedValueOnce(new Error('refused'));

    await store.readAll();

    expect(readAts(store)).toEqual([READ_AT]);
    expect(store.count()).toBe(0);
  });

  it('with an empty list, refused, leaves an empty list and a zero badge', async () => {
    const { store } = await render(0, []);
    api.bellControllerReadAll.mockRejectedValueOnce(new Error('refused'));

    await store.readAll();

    expect(store.items()).toEqual([]);
    expect(store.count()).toBe(0);
  });
});

// @traces 1315-FR-005
describe('BellStore first-page reloads answered out of order', () => {
  it('keeps a row read between two reloads read when the older answer lands last', async () => {
    const { store } = await render(2, [row('a'), row('b')]);
    const older = deferred<{ items: NotificationDto[]; nextCursor: null }>();
    const newer = deferred<{ items: NotificationDto[]; nextCursor: null }>();
    api.bellControllerList
      .mockImplementationOnce(() => older.promise)
      .mockImplementationOnce(() => newer.promise);

    const first = store.load();
    const second = store.load();
    await store.read('a');
    newer.resolve({
      items: [row('a', { readAt: READ_AT }), row('b')],
      nextCursor: null,
    });
    await second;
    older.resolve({ items: [row('a'), row('b')], nextCursor: null });
    await first;

    expect(store.items()[0].readAt).toBe(READ_AT);
  });

  it('drops the rows only the older answer carries', async () => {
    const { store } = await render(1, [row('a')]);
    const older = deferred<{ items: NotificationDto[]; nextCursor: null }>();
    const newer = deferred<{ items: NotificationDto[]; nextCursor: null }>();
    api.bellControllerList
      .mockImplementationOnce(() => older.promise)
      .mockImplementationOnce(() => newer.promise);

    const first = store.load();
    const second = store.load();
    newer.resolve({ items: [row('a')], nextCursor: null });
    await second;
    older.resolve({ items: [row('a'), row('stale')], nextCursor: null });
    await first;

    expect(ids(store)).toEqual(['a']);
  });

  it('applies both answers in order when the older lands first', async () => {
    const { store } = await render(1, [row('a')]);
    const older = deferred<{ items: NotificationDto[]; nextCursor: null }>();
    const newer = deferred<{ items: NotificationDto[]; nextCursor: null }>();
    api.bellControllerList
      .mockImplementationOnce(() => older.promise)
      .mockImplementationOnce(() => newer.promise);

    const first = store.load();
    const second = store.load();
    older.resolve({ items: [row('a')], nextCursor: null });
    await first;
    newer.resolve({ items: [row('a'), row('fresh')], nextCursor: null });
    await second;

    expect(ids(store)).toEqual(['a', 'fresh']);
  });

  it('still applies the newer answer when the older one fails after it', async () => {
    const { store } = await render(1, [row('a')]);
    const older = deferred<{ items: NotificationDto[]; nextCursor: null }>();
    api.bellControllerList
      .mockImplementationOnce(() => older.promise)
      .mockResolvedValueOnce({
        items: [row('a'), row('fresh')],
        nextCursor: null,
      });

    const first = store.load();
    await store.load();
    older.reject(new Error('down'));
    await first;

    expect(ids(store)).toEqual(['a', 'fresh']);
  });

  it('keeps a row read when two live-echo reloads answer in the other order', async () => {
    const { store } = await render(2, [row('a'), row('b')]);
    const older = deferred<{ items: NotificationDto[]; nextCursor: null }>();
    const newer = deferred<{ items: NotificationDto[]; nextCursor: null }>();
    api.bellControllerList
      .mockImplementationOnce(() => older.promise)
      .mockImplementationOnce(() => newer.promise);

    events.next({ at: READ_AT, id: 'b', kind: 'notification.read' });
    events.next({ at: READ_AT, id: 'b', kind: 'notification.read' });
    await tick();
    await store.read('a');
    newer.resolve({
      items: [row('a', { readAt: READ_AT }), row('b')],
      nextCursor: null,
    });
    await wait(10);
    older.resolve({ items: [row('a'), row('b')], nextCursor: null });
    await wait(10);

    expect(store.items()[0].readAt).toBe(READ_AT);
  });
});
