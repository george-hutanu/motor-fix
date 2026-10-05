import { Component, inject } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  type NotificationDto,
  NotificationsService,
} from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';
import { Overlays } from '@motor-fix/overlays';
import { Subject } from 'rxjs';

import { BellStore } from './bell';
import { ago, BellList } from './bell-list';
import { Live } from './live';

const minutesAgo = (n: number) =>
  new Date(Date.now() - n * 60_000).toISOString();

const row = (id: string, overrides: Partial<NotificationDto> = {}) =>
  ({
    at: minutesAgo(5),
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

@Component({ template: '' })
class Host {
  readonly overlays = inject(Overlays);
}

async function settle() {
  for (let i = 0; i < 6; i++) {
    TestBed.tick();
    await new Promise((resolve) => setTimeout(resolve));
  }
}

const panel = () =>
  document.querySelector<HTMLElement>('mf-overlay-panel') as HTMLElement;

async function render(
  list: () => Promise<{ items: NotificationDto[]; nextCursor: string | null }>,
  { load = true } = {},
) {
  api = {
    bellControllerList: jest.fn(list),
    bellControllerRead: jest.fn(async ({ id }: { id: string }) =>
      row(id, { readAt: new Date().toISOString() }),
    ),
    bellControllerReadAll: jest.fn(async () => undefined),
    bellControllerUnreadCount: jest.fn(async () => ({ count: 0 })),
  };
  TestBed.configureTestingModule({
    providers: [
      BellStore,
      { provide: NotificationsService, useValue: api },
      { provide: Live, useValue: { events: new Subject() } },
    ],
  });
  const store = TestBed.inject(BellStore);
  if (load) await store.load();
  const host = TestBed.createComponent(Host);
  void host.componentInstance.overlays.open(BellList, {
    data: store,
    shape: 'drawer',
    title: 'shell.bell.title',
  });
  await settle();
  const element = panel().querySelector('mf-bell-list') as HTMLElement;
  return { element, store };
}

const button = (element: HTMLElement, name: string) =>
  [...element.querySelectorAll('button')].find(
    (b) => b.textContent?.trim() === name,
  );

describe('BellList', () => {
  it('shows the rows with their time and unread mark', async () => {
    const { element } = await render(async () => ({
      items: [row('a'), row('b', { readAt: minutesAgo(1) })],
      nextCursor: null,
    }));

    const rows = [...element.querySelectorAll('li')];
    expect(
      rows.map((li) => li.querySelector('.text')?.textContent?.trim()),
    ).toEqual(['Text a', 'Text b']);
    expect(rows[0].querySelector('time')?.textContent?.trim()).toBe(
      'acum 5 min',
    );
    expect(rows[0].classList).toContain('unread');
    expect(rows[0].textContent).toContain('necitită');
    expect(rows[1].classList).not.toContain('unread');
    expect(rows[1].textContent).not.toContain('necitită');
  });

  it('shows the empty state', async () => {
    const { element } = await render(async () => ({
      items: [],
      nextCursor: null,
    }));

    expect(element.textContent).toContain('Nicio notificare încă');
  });

  it('shows three row skeletons while loading', async () => {
    const { element, store } = await render(
      () => new Promise(() => undefined),
      {
        load: false,
      },
    );

    void store.load();
    await settle();

    expect(element.querySelectorAll('[data-skeleton]')).toHaveLength(3);
    expect(element.querySelector('[aria-busy="true"]')).not.toBeNull();
  });

  it('offers a retry when the list fails to load', async () => {
    const { element } = await render(async () => {
      throw new Error('offline');
    });
    expect(element.textContent).toContain('Notificările nu s‑au încărcat.');
    api.bellControllerList.mockResolvedValue({
      items: [row('a')],
      nextCursor: null,
    });

    button(element, 'Reîncearcă')?.click();
    await settle();

    expect(element.querySelectorAll('li')).toHaveLength(1);
  });

  it('marks a tapped row read', async () => {
    const { element } = await render(async () => ({
      items: [row('a')],
      nextCursor: null,
    }));

    element.querySelector<HTMLButtonElement>('li button')?.click();
    await settle();

    expect(api.bellControllerRead).toHaveBeenCalledWith({ id: 'a' });
    expect(element.querySelector('li')?.classList).not.toContain('unread');
  });

  it('marks all read', async () => {
    const { element } = await render(async () => ({
      items: [row('a'), row('b')],
      nextCursor: null,
    }));

    button(element, 'Marchează tot ca citit')?.click();
    await settle();

    expect(api.bellControllerReadAll).toHaveBeenCalled();
    expect(element.querySelectorAll('li.unread')).toHaveLength(0);
  });

  it('hides mark all when nothing is unread', async () => {
    const { element } = await render(async () => ({
      items: [row('a', { readAt: minutesAgo(1) })],
      nextCursor: null,
    }));

    expect(button(element, 'Marchează tot ca citit')).toBeUndefined();
  });

  it('loads more on demand', async () => {
    const { element } = await render(async () => ({
      items: [row('a')],
      nextCursor: 'a',
    }));
    api.bellControllerList.mockResolvedValue({
      items: [row('b')],
      nextCursor: null,
    });

    button(element, 'Mai multe')?.click();
    await settle();

    expect(element.querySelectorAll('li')).toHaveLength(2);
    expect(button(element, 'Mai multe')).toBeUndefined();
  });
});

describe('ago', () => {
  const now = new Date('2026-10-05T12:00:00.000Z');
  const at = (minutes: number) =>
    new Date(now.getTime() - minutes * 60_000).toISOString();

  it('closes when its bell leaves the screen, as on a sign-out', async () => {
    const { store } = await render(async () => ({
      items: [row('a')],
      nextCursor: null,
    }));
    expect(panel()).not.toBeNull();

    store.ended.set(true);
    await settle();

    expect(panel()).toBeNull();
  });

  it('formats times relative up to a day, then as a date', async () => {
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
