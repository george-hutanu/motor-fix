import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import type { LiveMessage } from '@motor-fix/contracts';
import {
  type RequestSummaryDto,
  RequestsService,
} from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';
import { Subject } from 'rxjs';

import { RequestsView } from './requests-view';
import { Live } from '../live';

const row = (id: string): RequestSummaryDto => ({
  car: {
    brand: 'Dacia',
    engine: null,
    fuel: 'petrol',
    model: 'Logan',
    year: 2017,
  },
  closedAt: null,
  closedReason: null,
  createdAt: new Date(Date.now() - 5_000).toISOString(),
  description: null,
  expiresAt: '2026-10-16T09:00:00.000Z',
  id,
  jobs: [],
  quotesCount: 0,
  status: 'sent',
});

let scrolled: jest.Mock;

async function open(url: string, answer: () => Promise<unknown>) {
  scrolled = jest.fn();
  Element.prototype.scrollIntoView = scrolled;
  const events = new Subject<LiveMessage>();
  TestBed.configureTestingModule({
    providers: [
      provideRouter([
        {
          children: [{ component: RequestsView, path: '**' }],
          path: 'requests',
        },
      ]),
      {
        provide: RequestsService,
        useValue: { requestsControllerList: jest.fn(answer) },
      },
      {
        provide: Live,
        useValue: {
          events,
          on: () => events,
          resync: new Subject<void>(),
        },
      },
    ],
  });
  await TestBed.inject(I18n).enter('driver');
  const harness = await RouterTestingHarness.create();
  await harness.navigateByUrl(url);
  return harness;
}

async function settled(harness: RouterTestingHarness) {
  for (let i = 0; i < 6; i++) {
    harness.detectChanges();
    await harness.fixture.whenStable();
    await new Promise((r) => setTimeout(r));
  }
}

const focused = () =>
  (document.activeElement as HTMLElement | null)?.getAttribute('data-request');

const page =
  (...ids: string[]) =>
  async () => ({
    items: ids.map(row),
    nextCursor: null,
    total: ids.length,
  });

afterEach(() => {
  (document.activeElement as HTMLElement | null)?.blur();
  TestBed.resetTestingModule();
});

describe('Cererile mele opened at a request, hostile addresses', () => {
  // @traces 032-FR-004
  it('focuses the row once the list that was still loading arrives', async () => {
    let release: (v: unknown) => void = () => undefined;
    const harness = await open(
      '/requests/r2',
      () => new Promise((r) => (release = r)),
    );
    await settled(harness);
    expect(focused()).toBeNull();

    release({ items: [row('r1'), row('r2')], nextCursor: null, total: 2 });
    await settled(harness);

    expect(focused()).toBe('r2');
  });

  // @traces 032-FR-004
  it('focuses nothing when the list fails to load', async () => {
    const harness = await open('/requests/r2', () =>
      Promise.reject(new Error('x')),
    );
    await settled(harness);

    expect(focused()).toBeNull();
    expect(scrolled).not.toHaveBeenCalled();
  });

  // @traces 032-FR-004
  it('focuses nothing on a trailing slash without an id', async () => {
    const harness = await open('/requests/', page('r1'));
    await settled(harness);

    expect(focused()).toBeNull();
    expect(scrolled).not.toHaveBeenCalled();
  });

  // @traces 032-FR-004
  it('does not match an id that is only a prefix of a row id', async () => {
    const harness = await open('/requests/r', page('r1', 'r2'));
    await settled(harness);

    expect(focused()).toBeNull();
  });

  // @traces 032-FR-004
  it('does not treat a selector-like id as a pattern', async () => {
    const harness = await open(
      `/requests/${encodeURIComponent('"],[data-request')}`,
      page('r1'),
    );
    await settled(harness);

    expect(focused()).toBeNull();
    expect(scrolled).not.toHaveBeenCalled();
  });

  // @traces 032-FR-004
  it('moves the focus when the address changes to another row', async () => {
    const harness = await open('/requests/r1', page('r1', 'r2'));
    await settled(harness);
    await harness.navigateByUrl('/requests/r2');
    await settled(harness);

    expect(focused()).toBe('r2');
  });
});
