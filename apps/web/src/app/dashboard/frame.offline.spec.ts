import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import type { LiveMessage } from '@motor-fix/contracts';
import type { MeDto } from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';
import { Overlays } from '@motor-fix/overlays';
import { Subject } from 'rxjs';

import { Frame } from './frame';
import { Live } from './live';
import { Session } from './session';
import { dashboardRoutes } from './views';

const me = {
  capabilities: [],
  email: null,
  garageId: null,
  id: 'account-1',
  landing: '/app/driver',
  language: 'ro',
  name: 'Ioana Pop',
  role: 'driver',
  roles: ['driver'],
} as unknown as MeDto;

async function render(language: 'ro' | 'en' = 'ro') {
  Element.prototype.scrollIntoView = jest.fn();
  const live = {
    close: jest.fn(),
    events: new Subject<LiveMessage>(),
    offline: signal(false),
    open: jest.fn(),
    resync: new Subject<void>(),
  };
  const session = {
    current: signal<MeDto | null>(me),
    ended: new Subject<void>(),
    reload: jest.fn(async () => undefined),
    signOut: jest.fn(),
  };
  TestBed.configureTestingModule({
    providers: [
      provideRouter([
        {
          children: dashboardRoutes('driver'),
          component: Frame,
          path: 'app/driver',
        },
      ]),
      { provide: Session, useValue: session },
      { provide: Live, useValue: live },
      { provide: Overlays, useValue: { open: jest.fn() } },
    ],
  });
  await TestBed.inject(I18n).use(language);
  const harness = await RouterTestingHarness.create();
  await harness.navigateByUrl('/app/driver');
  harness.detectChanges();
  const element = harness.fixture.nativeElement as HTMLElement;
  return { element, harness, live, session };
}

const bar = (element: HTMLElement) =>
  element.querySelector<HTMLElement>('.live-offline');

describe('the offline bar', () => {
  it('is empty while the live connection is fine', async () => {
    const { element } = await render();

    expect(bar(element)?.getAttribute('role')).toBe('status');
    expect(bar(element)?.textContent?.trim()).toBe('');
  });

  it.each([
    ['ro', 'Fără conexiune. Ce vezi poate fi vechi.'],
    ['en', 'No connection. What you see may be out of date.'],
  ] as const)('says the screen may be out of date while offline (%s), and clears once back', async (language, text) => {
    const { element, harness, live } = await render(language);

    live.offline.set(true);
    harness.detectChanges();
    expect(bar(element)?.textContent?.trim()).toBe(text);

    live.offline.set(false);
    harness.detectChanges();
    expect(bar(element)?.textContent?.trim()).toBe('');
  });

  it('sits under the header, above the e-mail banner', async () => {
    const { element } = await render();
    const view = element.querySelector('.view') as HTMLElement;
    const order = [...view.children].map((c) => c.tagName.toLowerCase());

    expect(order.indexOf('header')).toBeLessThan(order.indexOf('p'));
    expect(
      [...view.children].indexOf(bar(element) as HTMLElement),
    ).toBeLessThan(order.indexOf('mf-email-banner'));
  });
});

describe('getting back in step', () => {
  it('re-reads the account when the live connection asks for it', async () => {
    const { live, session } = await render();
    session.reload.mockClear();

    live.resync.next();

    expect(session.reload).toHaveBeenCalledTimes(1);
  });
});
