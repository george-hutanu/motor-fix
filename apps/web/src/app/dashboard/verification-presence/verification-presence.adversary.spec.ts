import { HttpErrorResponse } from '@angular/common/http';
import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { LiveMessage } from '@motor-fix/contracts';
import { ApiConfiguration } from '@motor-fix/data-access/api-configuration';
import { AdminService } from '@motor-fix/data-access/services/admin.service';
import { I18n } from '@motor-fix/i18n';
import { Subject } from 'rxjs';

import { VerificationPresence } from './verification-presence';
import { Live } from '../live';
import { Session } from '../session';

const FILE = 'f1e2d3c4-0000-4000-8000-000000000001';
const OTHER = 'f1e2d3c4-0000-4000-8000-000000000002';
const ANA = { name: 'Ana P.', since: '2026-10-24T07:42:11.000Z' };

let events: Subject<LiveMessage>;
let resyncs: Subject<void>;
let token: string | null;
const api = { verificationFileControllerPresence: jest.fn() };
let fetchMock: jest.Mock;
let intervals: { delay: number; run: () => void }[];
const realSetInterval = globalThis.setInterval;

const pause = (ms = 1) => new Promise((resolve) => setTimeout(resolve, ms));

async function settle(fixture: {
  detectChanges(): void;
  whenStable(): Promise<unknown>;
}) {
  for (let i = 0; i < 3; i++) {
    fixture.detectChanges();
    await fixture.whenStable();
    await pause();
  }
}

async function render({
  language = 'ro',
  platform = 'browser',
}: {
  language?: 'ro' | 'en';
  platform?: 'browser' | 'server';
} = {}) {
  TestBed.configureTestingModule({
    providers: [
      { provide: AdminService, useValue: api },
      { provide: ApiConfiguration, useValue: { rootUrl: 'https://api.test' } },
      {
        provide: Live,
        useValue: { events: events.asObservable(), resync: resyncs },
      },
      { provide: Session, useValue: { token: () => token } },
      { provide: PLATFORM_ID, useValue: platform },
    ],
  });
  const i18n = TestBed.inject(I18n);
  await i18n.enter('admin');
  if (language === 'en') await i18n.use('en');
  const fixture = TestBed.createComponent(VerificationPresence);
  fixture.componentRef.setInput('fileId', FILE);
  await settle(fixture);
  return { fixture, host: fixture.nativeElement as HTMLElement };
}

const text = (element: Element | null | undefined) =>
  (element?.textContent ?? '').replace(/\s+/g, ' ').trim();
const banner = (host: HTMLElement) => host.querySelector('[role="status"]');
const leaves = () =>
  fetchMock.mock.calls.filter(
    ([, init]) => (init as RequestInit | undefined)?.method === 'DELETE',
  );

beforeEach(() => {
  events = new Subject<LiveMessage>();
  resyncs = new Subject<void>();
  token = 'token-1';
  intervals = [];
  jest.spyOn(globalThis, 'setInterval').mockImplementation(((
    run: () => void,
    delay?: number,
  ) => {
    // The debounce of the live changes runs on rxjs's own setInterval.
    if (delay !== 20_000) return realSetInterval(run, delay);
    intervals.push({ delay, run });
    return realSetInterval(() => undefined, 1_000_000);
  }) as typeof setInterval);
  fetchMock = jest.fn(async () => new Response(null, { status: 204 }));
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  api.verificationFileControllerPresence
    .mockReset()
    .mockResolvedValue({ others: [ANA] });
});

afterEach(() => {
  TestBed.resetTestingModule();
  jest.restoreAllMocks();
});

// @traces 413-FR-004 413-FR-008 413-FR-009

describe('the banner against hostile answers', () => {
  it('shows a name carrying markup as plain text', async () => {
    api.verificationFileControllerPresence.mockResolvedValue({
      others: [{ name: '<img src=x onerror=alert(1)>', since: ANA.since }],
    });

    const { host } = await render();

    expect(host.querySelector('img')).toBeNull();
    expect(text(banner(host))).toBe(
      '<img src=x onerror=alert(1)> are dosarul deschis din 10:42',
    );
  });

  it.each([
    ['2026-10-24T21:05:00.000Z', '00:05'],
    ['2026-10-24T20:59:00.000Z', '23:59'],
    ['2026-12-01T07:42:00.000Z', '09:42'],
    ['2026-10-25T00:30:00.000Z', '03:30'],
    ['2026-10-25T01:30:00.000Z', '03:30'],
    ['2026-03-29T00:59:00.000Z', '02:59'],
    ['2026-03-29T01:00:00.000Z', '04:00'],
  ])('shows %s as %s in Bucharest', async (since, shown) => {
    api.verificationFileControllerPresence.mockResolvedValue({
      others: [{ name: 'Ana P.', since }],
    });

    const { host } = await render();

    expect(text(banner(host))).toBe(`Ana P. are dosarul deschis din ${shown}`);
  });

  it('lists a crowd of thirty admins in one sentence', async () => {
    api.verificationFileControllerPresence.mockResolvedValue({
      others: Array.from({ length: 30 }, (_, i) => ({
        name: `Admin${i}`,
        since: ANA.since,
      })),
    });

    const { host } = await render({ language: 'en' });

    const line = text(banner(host));
    expect(host.querySelectorAll('[role="status"]')).toHaveLength(1);
    expect(line.startsWith('Admin0 (since 10:42), Admin1 (since 10:42)')).toBe(
      true,
    );
    expect(line.endsWith('and Admin29 (since 10:42) have the file open')).toBe(
      true,
    );
  });

  it('removes the banner when a later read answers nobody', async () => {
    const { fixture, host } = await render();
    api.verificationFileControllerPresence.mockResolvedValue({ others: [] });

    events.next({ id: FILE, kind: 'presence.changed' } as LiveMessage);
    await pause(350);
    await settle(fixture);

    expect(banner(host)).toBeNull();
  });

  it('removes the banner when a later read fails', async () => {
    const { fixture, host } = await render();
    api.verificationFileControllerPresence.mockRejectedValue(
      new HttpErrorResponse({ status: 500 }),
    );

    events.next({ id: FILE, kind: 'presence.changed' } as LiveMessage);
    await pause(350);
    await settle(fixture);

    expect(banner(host)).toBeNull();
  });

  it('treats an answer without an others list as nobody', async () => {
    api.verificationFileControllerPresence.mockResolvedValue({});

    const { host } = await render();

    expect(banner(host)).toBeNull();
  });
});

describe('the drawer after it left', () => {
  it('reads nothing when a change for its file arrives after the page hid', async () => {
    const { fixture } = await render();
    window.dispatchEvent(new Event('pagehide'));
    const calls = api.verificationFileControllerPresence.mock.calls.length;

    events.next({ id: FILE, kind: 'presence.changed' } as LiveMessage);
    await pause(350);
    await settle(fixture);

    expect(api.verificationFileControllerPresence.mock.calls.length).toBe(
      calls,
    );
  });

  it('reads nothing when the stream resyncs after the page hid', async () => {
    const { fixture } = await render();
    window.dispatchEvent(new Event('pagehide'));
    const calls = api.verificationFileControllerPresence.mock.calls.length;

    resyncs.next();
    await pause(350);
    await settle(fixture);

    expect(api.verificationFileControllerPresence.mock.calls.length).toBe(
      calls,
    );
  });

  it('reads nothing when a change for its file arrives after destroy', async () => {
    const { fixture } = await render();
    fixture.destroy();
    const calls = api.verificationFileControllerPresence.mock.calls.length;

    events.next({ id: FILE, kind: 'presence.changed' } as LiveMessage);
    resyncs.next();
    await pause(350);

    expect(api.verificationFileControllerPresence.mock.calls.length).toBe(
      calls,
    );
  });

  it('leaves for a heartbeat still in flight when the drawer closes', async () => {
    api.verificationFileControllerPresence.mockReturnValue(
      new Promise(() => undefined),
    );
    const { fixture } = await render();

    fixture.destroy();

    expect(leaves()).toHaveLength(1);
  });

  it('stops its heartbeat timer when the drawer closes', async () => {
    const clear = jest.spyOn(globalThis, 'clearInterval');
    const { fixture } = await render();

    fixture.destroy();

    expect(clear).toHaveBeenCalled();
  });

  it('sends no leave to another file than its own', async () => {
    const { fixture } = await render();

    fixture.destroy();

    expect(leaves().map(([address]) => address)).toEqual([
      `https://api.test/api/v1/admin/verification-files/${FILE}/presence`,
    ]);
  });
});

describe('messages that are not for the banner', () => {
  it.each([
    ['another kind for its file', { id: FILE, kind: 'verification.changed' }],
    ['a presence change without an id', { kind: 'presence.changed' }],
    [
      'a presence change with a null id',
      { id: null, kind: 'presence.changed' },
    ],
    [
      'a presence change for the upper case spelling of another file',
      { id: OTHER.toUpperCase(), kind: 'presence.changed' },
    ],
  ])('reads nothing for %s', async (_title, message) => {
    const { fixture } = await render();

    events.next(message as unknown as LiveMessage);
    await pause(350);
    await settle(fixture);

    expect(api.verificationFileControllerPresence).toHaveBeenCalledTimes(1);
  });

  it('collapses a burst of fifty changes for its file into far fewer reads', async () => {
    const { fixture } = await render();

    for (let i = 0; i < 50; i++)
      events.next({ id: FILE, kind: 'presence.changed' } as LiveMessage);
    await pause(350);
    await settle(fixture);

    expect(
      api.verificationFileControllerPresence.mock.calls.length,
    ).toBeLessThan(10);
  });
});
