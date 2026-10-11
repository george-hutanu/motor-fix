import { Component, inject } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import {
  type NotificationDto,
  NotificationsService,
} from '@motor-fix/data-access';
import { Overlays } from '@motor-fix/overlays';
import { Subject } from 'rxjs';

import { BellList } from './bell-list';
import { BellStore } from '../bell/bell';
import { Live } from '../live';

const row = (id: string, over: Partial<NotificationDto> = {}) =>
  ({
    at: new Date(Date.now() - 300_000).toISOString(),
    id,
    kind: 'DUE_ITP',
    link: null,
    readAt: null,
    subjectId: null,
    text: `Text ${id}`,
    ...over,
  }) as NotificationDto;

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

const panel = () => document.querySelector<HTMLElement>('mf-overlay-panel');

async function render(
  items: NotificationDto[],
  read: () => Promise<unknown> = async () => row('x'),
) {
  const api = {
    bellControllerList: jest.fn(async () => ({ items, nextCursor: null })),
    bellControllerRead: jest.fn(read),
    bellControllerReadAll: jest.fn(async () => undefined),
    bellControllerUnreadCount: jest.fn(async () => ({ count: 0 })),
  };
  TestBed.configureTestingModule({
    providers: [
      BellStore,
      provideRouter([]),
      { provide: NotificationsService, useValue: api },
      { provide: Live, useValue: { events: new Subject() } },
    ],
  });
  const store = TestBed.inject(BellStore);
  await store.load();
  const host = TestBed.createComponent(Host);
  const closed = host.componentInstance.overlays.open<string, BellStore>(
    BellList,
    { data: store, shape: 'drawer', title: 'shell.bell.title' },
  );
  await settle();
  const element = panel()?.querySelector('mf-bell-list') as HTMLElement;
  return { api, closed, element };
}

const tap = async (element: HTMLElement, index = 0) => {
  element.querySelectorAll<HTMLButtonElement>('li button')[index].click();
  await settle();
};

afterEach(() => TestBed.resetTestingModule());

describe('BellList taps under failure', () => {
  // @traces 032-FR-003
  it('still opens the view and closes the list when marking read fails', async () => {
    const { closed, element } = await render(
      [row('a', { link: '/app/driver/cars/c1' })],
      async () => {
        throw new Error('offline');
      },
    );

    await tap(element);

    await expect(closed).resolves.toBe('/app/driver/cars/c1');
    expect(panel()).toBeNull();
  });

  // @traces 032-FR-002
  it('treats an empty link as no link and keeps the list open', async () => {
    const { api, element } = await render([row('a', { link: '' })]);
    const navigate = jest.spyOn(TestBed.inject(Router), 'navigateByUrl');

    await tap(element);

    expect(api.bellControllerRead).toHaveBeenCalledWith({ id: 'a' });
    expect(navigate).not.toHaveBeenCalled();
    expect(panel()).not.toBeNull();
  });

  // @traces 032-FR-001
  it('opens each row its own address when two rows are tapped in turn', async () => {
    const { closed, element } = await render([
      row('a', { link: '/app/driver/cars/c1' }),
      row('b', { kind: 'REVIEW_INVITE', link: '/app/driver/reviews' }),
    ]);

    await tap(element, 1);

    await expect(closed).resolves.toBe('/app/driver/reviews');
  });

  // @traces 032-FR-001
  it('marks an unmapped row read and leaves its neighbours unread', async () => {
    const { api, element } = await render([
      row('a', { kind: 'TEST_MESSAGE' }),
      row('b', { kind: 'TEST_MESSAGE' }),
    ]);

    await tap(element, 1);

    expect(api.bellControllerRead).toHaveBeenCalledTimes(1);
    expect(api.bellControllerRead).toHaveBeenCalledWith({ id: 'b' });
    expect(element.querySelectorAll('li')[0].classList.contains('unread')).toBe(
      true,
    );
  });

  // @traces 032-FR-005
  it('shows a row whose link names a car that no longer exists and navigates without error', async () => {
    const { closed, element } = await render([
      row('a', { link: '/app/driver/cars/removed-car', text: 'ITP gone' }),
    ]);

    expect(element.querySelector('.text')?.textContent?.trim()).toBe(
      'ITP gone',
    );
    await tap(element);

    await expect(closed).resolves.toBe('/app/driver/cars/removed-car');
  });
});
