import { TestBed } from '@angular/core/testing';
import type { LiveMessage } from '@motor-fix/contracts';
import {
  type NotificationDto,
  NotificationsService,
} from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';
import { Overlays } from '@motor-fix/overlays';
import { toast } from '@motor-fix/ui-cockpit';
import { Subject } from 'rxjs';

import { Bell, BellStore } from './bell';
import { Live } from './live';

jest.mock('@motor-fix/ui-cockpit', () => ({
  ...jest.requireActual('@motor-fix/ui-cockpit'),
  toast: jest.fn(),
}));

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
let open: jest.Mock;

function setup(count = 0, items: NotificationDto[] = []) {
  api = {
    bellControllerList: jest.fn(async () => ({ items, nextCursor: null })),
    bellControllerRead: jest.fn(async ({ id }: { id: string }) =>
      row(id, { readAt: '2026-10-05T09:00:00.000Z' }),
    ),
    bellControllerReadAll: jest.fn(async () => undefined),
    bellControllerUnreadCount: jest.fn(async () => ({ count })),
  };
  events = new Subject();
  open = jest.fn(async () => 'cancelled');
  TestBed.configureTestingModule({
    providers: [
      { provide: NotificationsService, useValue: api },
      { provide: Live, useValue: { events } },
      { provide: Overlays, useValue: { open } },
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

async function render(count = 0, items: NotificationDto[] = []) {
  setup(count, items);
  const fixture = TestBed.createComponent(Bell);
  await settle(fixture);
  const element = fixture.nativeElement as HTMLElement;
  const button = element.querySelector('button') as HTMLButtonElement;
  const store = fixture.debugElement.injector.get(BellStore);
  return { button, element, fixture, store };
}

beforeEach(() => jest.mocked(toast).mockClear());
afterEach(() => jest.useRealTimers());

describe('Bell', () => {
  it('shows the unread count, 9+ above 9 and nothing at 0', async () => {
    const three = await render(3);
    expect(three.element.querySelector('.badge')?.textContent?.trim()).toBe(
      '3',
    );
    TestBed.resetTestingModule();

    const many = await render(12);
    expect(many.element.querySelector('.badge')?.textContent?.trim()).toBe(
      '9+',
    );
    TestBed.resetTestingModule();

    const none = await render(0);
    expect(none.element.querySelector('.badge')).toBeNull();
  });

  it("names the count in the button's label", async () => {
    const { button } = await render(3);
    expect(button.getAttribute('aria-label')).toBe(
      'Notificări, 3 notificări necitite',
    );
    TestBed.resetTestingModule();

    const none = await render(0);
    expect(none.button.getAttribute('aria-label')).toBe('Notificări');
  });

  it('opens the list in the drawer with its first page, and refreshes the count', async () => {
    const { button, fixture } = await render(1, [row('a')]);
    api.bellControllerUnreadCount.mockClear();

    button.click();
    await settle(fixture);

    expect(open).toHaveBeenCalledWith(expect.any(Function), {
      data: expect.any(BellStore),
      shape: 'drawer',
      title: 'shell.bell.title',
    });
    expect(api.bellControllerList).toHaveBeenCalledWith({ language: 'ro' });
    expect(api.bellControllerUnreadCount).toHaveBeenCalled();
  });

  it('toasts a new notification and refreshes', async () => {
    const { element, fixture, store } = await render(0);
    await store.load();
    api.bellControllerUnreadCount.mockResolvedValue({ count: 1 });
    api.bellControllerList.mockResolvedValue({
      items: [row('new', { text: 'Ofertă nouă de la Service Auto Nord' })],
      nextCursor: null,
    });

    events.next({
      at: '2026-10-05T08:00:00.000Z',
      id: 'new',
      kind: 'notification.created',
    });
    await settle(fixture);

    expect(toast).toHaveBeenCalledWith('Ofertă nouă de la Service Auto Nord', {
      duration: 5000,
    });
    expect(element.querySelector('.badge')?.textContent?.trim()).toBe('1');
    expect(store.items().map((n) => n.id)).toEqual(['new']);
  });

  it('keeps the rows already loaded when a new one joins the top', async () => {
    const { fixture, store } = await render(0, [row('a'), row('b')]);
    await store.load();
    api.bellControllerList.mockResolvedValue({
      items: [row('new'), row('a')],
      nextCursor: 'a',
    });

    events.next({
      at: '2026-10-05T08:00:00.000Z',
      id: 'new',
      kind: 'notification.created',
    });
    await settle(fixture);

    expect(store.items().map((n) => n.id)).toEqual(['new', 'a', 'b']);
  });

  it('toasts the generic text when the new row is not in the first page', async () => {
    const { fixture } = await render(0);

    events.next({
      at: '2026-10-05T08:00:00.000Z',
      id: 'gone',
      kind: 'notification.created',
    });
    await settle(fixture);

    expect(toast).toHaveBeenCalledWith('Ai o notificare nouă', {
      duration: 5000,
    });
  });

  it('refreshes on a read in another tab', async () => {
    const { element, fixture, store } = await render(2, [row('a'), row('b')]);
    await store.load();
    api.bellControllerUnreadCount.mockResolvedValue({ count: 0 });
    api.bellControllerList.mockResolvedValue({
      items: [row('a', { readAt: 'x' }), row('b', { readAt: 'x' })],
      nextCursor: null,
    });

    events.next({
      at: '2026-10-05T08:00:00.000Z',
      id: 'account-1',
      kind: 'notification.read',
    });
    await settle(fixture);

    expect(element.querySelector('.badge')).toBeNull();
    expect(store.items().every((n) => n.readAt)).toBe(true);
    expect(toast).not.toHaveBeenCalled();
  });

  it('keeps the badge when the count fails to load', async () => {
    const { element, fixture, store } = await render(4);
    api.bellControllerUnreadCount.mockRejectedValue(new Error('offline'));

    await store.refreshCount();
    await settle(fixture);

    expect(element.querySelector('.badge')?.textContent?.trim()).toBe('4');
  });

  it('refreshes the count every 60 seconds', async () => {
    jest.useFakeTimers();
    const { fixture } = await render(0);
    api.bellControllerUnreadCount.mockClear();

    jest.advanceTimersByTime(59_000);
    expect(api.bellControllerUnreadCount).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1_000);
    expect(api.bellControllerUnreadCount).toHaveBeenCalledTimes(1);

    fixture.destroy();
    jest.advanceTimersByTime(120_000);
    expect(api.bellControllerUnreadCount).toHaveBeenCalledTimes(1);
  });

  it('marks its store ended when it leaves the screen', async () => {
    const { fixture, store } = await render(1, [row('a')]);
    expect(store.ended()).toBe(false);

    fixture.destroy();

    expect(store.ended()).toBe(true);
  });
});

describe('BellStore', () => {
  it('marks one read and lowers the count', async () => {
    const { store } = await render(2, [row('a'), row('b')]);
    await store.load();

    await store.read('a');

    expect(api.bellControllerRead).toHaveBeenCalledWith({ id: 'a' });
    expect(store.items().find((n) => n.id === 'a')?.readAt).toBe(
      '2026-10-05T09:00:00.000Z',
    );
    expect(store.count()).toBe(1);
  });

  it('marks all read and clears the count', async () => {
    const { store } = await render(2, [row('a'), row('b')]);
    await store.load();

    await store.readAll();

    expect(api.bellControllerReadAll).toHaveBeenCalled();
    expect(store.items().every((n) => n.readAt)).toBe(true);
    expect(store.count()).toBe(0);
  });

  it('loads the next page after the last row', async () => {
    const { store } = await render(0);
    api.bellControllerList.mockResolvedValueOnce({
      items: [row('a')],
      nextCursor: 'a',
    });
    await store.load();
    expect(store.more()).toBe(true);
    api.bellControllerList.mockResolvedValueOnce({
      items: [row('b')],
      nextCursor: null,
    });

    await store.loadMore();

    expect(api.bellControllerList).toHaveBeenLastCalledWith({
      cursor: 'a',
      language: 'ro',
    });
    expect(store.items().map((n) => n.id)).toEqual(['a', 'b']);
    expect(store.more()).toBe(false);
  });

  it('asks for the texts in the language on screen', async () => {
    const { store } = await render(0);
    await TestBed.inject(I18n).use('en');

    await store.load();

    expect(api.bellControllerList).toHaveBeenLastCalledWith({ language: 'en' });
  });
  it('does not ask again for a row already read', async () => {
    const { store } = await render(1, [row('a', { readAt: 'x' })]);
    await store.load();

    await store.read('a');

    expect(api.bellControllerRead).not.toHaveBeenCalled();
    expect(store.count()).toBe(1);
  });

  it('says so when a read fails, and keeps the row and the count', async () => {
    const { store } = await render(1, [row('a')]);
    await store.load();
    api.bellControllerRead.mockRejectedValue(new Error('offline'));

    await store.read('a');

    expect(toast).toHaveBeenCalledWith(
      'Notificarea nu a putut fi marcată ca citită.',
    );
    expect(store.items()[0].readAt).toBeNull();
    expect(store.count()).toBe(1);
  });

  it('says so when marking all fails, and keeps the rows and the count', async () => {
    const { store } = await render(2, [row('a'), row('b')]);
    await store.load();
    api.bellControllerReadAll.mockRejectedValue(new Error('offline'));

    await store.readAll();

    expect(toast).toHaveBeenCalledWith(
      'Notificarea nu a putut fi marcată ca citită.',
    );
    expect(store.items().every((n) => n.readAt === null)).toBe(true);
    expect(store.count()).toBe(2);
  });

  it('loads one next page for two taps in a row', async () => {
    const { store } = await render(0);
    api.bellControllerList.mockResolvedValueOnce({
      items: [row('a')],
      nextCursor: 'a',
    });
    await store.load();
    api.bellControllerList.mockResolvedValue({
      items: [row('b')],
      nextCursor: null,
    });

    await Promise.all([store.loadMore(), store.loadMore()]);

    expect(store.items().map((n) => n.id)).toEqual(['a', 'b']);
  });

  it('says so when the next page fails, and lets it be asked again', async () => {
    const { store } = await render(0);
    api.bellControllerList.mockResolvedValueOnce({
      items: [row('a')],
      nextCursor: 'a',
    });
    await store.load();
    api.bellControllerList.mockRejectedValueOnce(new Error('offline'));

    await store.loadMore();

    expect(toast).toHaveBeenCalledWith('Notificările nu s‑au încărcat.');
    expect(store.items().map((n) => n.id)).toEqual(['a']);
    expect(store.more()).toBe(true);
  });

  async function twoPages(count: number) {
    const shown = await render(count);
    api.bellControllerList.mockResolvedValueOnce({
      items: [row('a')],
      nextCursor: 'a',
    });
    await shown.store.load();
    api.bellControllerList.mockResolvedValueOnce({
      items: [row('b')],
      nextCursor: 'b',
    });
    await shown.store.loadMore();
    return shown;
  }

  const readLive = (id: string) =>
    events.next({
      at: '2026-10-05T10:00:00.000Z',
      id,
      kind: 'notification.read',
    });

  it('keeps every loaded page when its own read comes back live', async () => {
    const { fixture, store } = await twoPages(2);
    await store.read('b');
    api.bellControllerList.mockResolvedValue({
      items: [row('a')],
      nextCursor: 'a',
    });

    readLive('b');
    await settle(fixture);

    expect(store.items().map((n) => n.id)).toEqual(['a', 'b']);
    expect(store.items()[1].readAt).toBe('2026-10-05T09:00:00.000Z');
    expect(store.more()).toBe(true);
  });

  it('marks the row another tab read, wherever it sits, and keeps the rest unread', async () => {
    const { fixture, store } = await twoPages(1);
    api.bellControllerUnreadCount.mockResolvedValue({ count: 1 });
    api.bellControllerList.mockResolvedValue({
      items: [row('a')],
      nextCursor: 'a',
    });

    readLive('b');
    await settle(fixture);

    expect(store.items().map((n) => [n.id, n.readAt])).toEqual([
      ['a', null],
      ['b', '2026-10-05T10:00:00.000Z'],
    ]);
  });

  it('merges the reloaded first page in front of the rows below it, and loads on after the last row', async () => {
    const { fixture, store } = await twoPages(2);
    api.bellControllerUnreadCount.mockResolvedValue({ count: 1 });
    api.bellControllerList.mockResolvedValue({
      items: [row('a', { readAt: 'x' })],
      nextCursor: 'a',
    });

    readLive('a');
    await settle(fixture);

    expect(store.items().map((n) => [n.id, n.readAt])).toEqual([
      ['a', 'x'],
      ['b', null],
    ]);
    api.bellControllerList.mockResolvedValueOnce({
      items: [row('c')],
      nextCursor: null,
    });
    await store.loadMore();
    expect(api.bellControllerList).toHaveBeenLastCalledWith({
      cursor: 'b',
      language: 'ro',
    });
    expect(store.items().map((n) => n.id)).toEqual(['a', 'b', 'c']);
  });

  it('shows every loaded row read when a read elsewhere leaves nothing unread', async () => {
    const { fixture, store } = await twoPages(2);
    api.bellControllerUnreadCount.mockResolvedValue({ count: 0 });
    api.bellControllerList.mockResolvedValue({
      items: [row('a', { readAt: 'x' })],
      nextCursor: 'a',
    });

    readLive('account-1');
    await settle(fixture);

    expect(store.items().map((n) => n.id)).toEqual(['a', 'b']);
    expect(store.items()[1].readAt).toBe('2026-10-05T10:00:00.000Z');
    expect(store.count()).toBe(0);
  });

  it('keeps the rows and marks the read one when the first page fails to reload', async () => {
    const { fixture, store } = await twoPages(2);
    api.bellControllerUnreadCount.mockResolvedValue({ count: 1 });
    api.bellControllerList.mockRejectedValue(new Error('offline'));

    readLive('b');
    await settle(fixture);

    expect(store.items().map((n) => [n.id, n.readAt])).toEqual([
      ['a', null],
      ['b', '2026-10-05T10:00:00.000Z'],
    ]);
    expect(store.more()).toBe(true);
  });
});
