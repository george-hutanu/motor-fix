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

import { ago, Bell, BellStore } from './bell';
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

describe('ago', () => {
  const now = new Date('2026-10-05T12:00:00.000Z');
  const at = (minutes: number) =>
    new Date(now.getTime() - minutes * 60_000).toISOString();

  it('formats times relative up to a day, then as a date', async () => {
    setup();
    const i18n = TestBed.inject(I18n);

    expect(ago(at(0.5), now, i18n)).toBe('acum');
    expect(ago(at(5), now, i18n)).toBe('acum 5 min');
    expect(ago(at(59), now, i18n)).toBe('acum 59 min');
    expect(ago(at(60), now, i18n)).toBe('acum 1 h');
    expect(ago(at(23 * 60 + 59), now, i18n)).toBe('acum 23 h');
    // A day old, shown as its day in Bucharest (UTC+3 in October).
    expect(ago('2026-10-03T22:30:00.000Z', now, i18n)).toBe('4 oct. 2026');

    await i18n.use('en');
    expect(ago(at(5), now, i18n)).toBe('5 min ago');
    expect(ago(at(0.5), now, i18n)).toBe('just now');
  });
});

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
});

describe('BellStore', () => {
  it('marks one read and lowers the count', async () => {
    const { store } = await render(2, [row('a'), row('b')]);
    await store.load();

    await store.read('a');

    expect(api.bellControllerRead).toHaveBeenCalledWith({ id: 'a' });
    expect(store.items().find((n) => n.id === 'a')?.readAt).toBeTruthy();
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
});
