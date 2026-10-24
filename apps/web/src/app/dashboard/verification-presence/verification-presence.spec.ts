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
const ION = { name: 'Ion', since: '2026-10-24T07:47:30.000Z' };
const MIHAI = { name: 'Mihai I.', since: '2026-10-24T08:05:00.000Z' };

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
const heartbeats = () => intervals.filter(({ delay }) => delay === 20_000);
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

describe('the presence banner of a verification file', () => {
  // @traces 413-FR-008 413-FR-009 413-FR-012 413-FR-014
  it('names the one other admin and since when, in Romanian', async () => {
    const { host } = await render();

    expect(api.verificationFileControllerPresence).toHaveBeenCalledWith({
      id: FILE,
    });
    expect(text(banner(host))).toBe('Ana P. are dosarul deschis din 10:42');
  });

  // @traces 413-FR-009 413-FR-012
  it('names the one other admin in English', async () => {
    const { host } = await render({ language: 'en' });

    expect(text(banner(host))).toBe('Ana P. has had the file open since 10:42');
  });

  // @traces 413-FR-009 413-FR-012
  it('lists two admins joined by and, each with their time', async () => {
    api.verificationFileControllerPresence.mockResolvedValue({
      others: [ANA, ION],
    });

    const ro = await render();
    expect(text(banner(ro.host))).toBe(
      'Ana P. (din 10:42) și Ion (din 10:47) au dosarul deschis',
    );
    TestBed.resetTestingModule();

    const en = await render({ language: 'en' });
    expect(text(banner(en.host))).toBe(
      'Ana P. (since 10:42) and Ion (since 10:47) have the file open',
    );
  });

  // @traces 413-FR-009
  it('separates three admins with commas and the last with and', async () => {
    api.verificationFileControllerPresence.mockResolvedValue({
      others: [ANA, ION, MIHAI],
    });

    const { host } = await render();

    expect(text(banner(host))).toBe(
      'Ana P. (din 10:42), Ion (din 10:47) și Mihai I. (din 11:05) au dosarul deschis',
    );
  });

  // @traces 413-FR-008
  it('shows nothing when nobody else has the file open', async () => {
    api.verificationFileControllerPresence.mockResolvedValue({ others: [] });

    const { host } = await render();

    expect(banner(host)).toBeNull();
    expect(text(host)).toBe('');
  });

  // @traces 413-FR-006
  it('shows nothing when the read fails or the file is gone', async () => {
    api.verificationFileControllerPresence.mockRejectedValue(
      new HttpErrorResponse({ status: 404 }),
    );

    const { host } = await render();

    expect(banner(host)).toBeNull();
  });

  // @traces 413-FR-012
  it('announces itself politely with an amber lamp', async () => {
    const { host } = await render();

    const status = banner(host);
    expect(status?.tagName).toBe('P');
    expect(status?.querySelector('mf-lamp')?.getAttribute('data-state')).toBe(
      'amber',
    );
  });

  // @traces 413-FR-008
  it('reads again on a change for its own file and not for another', async () => {
    const { fixture, host } = await render();
    api.verificationFileControllerPresence.mockResolvedValue({
      others: [ANA, ION],
    });

    events.next({ id: OTHER, kind: 'presence.changed' } as LiveMessage);
    await pause(350);
    await settle(fixture);
    expect(api.verificationFileControllerPresence).toHaveBeenCalledTimes(1);

    events.next({ id: FILE, kind: 'presence.changed' } as LiveMessage);
    await pause(350);
    await settle(fixture);
    expect(api.verificationFileControllerPresence).toHaveBeenCalledTimes(2);
    expect(text(banner(host))).toContain('Ion (din 10:47)');
  });
});

describe('the heartbeat and the leave', () => {
  // @traces 413-FR-004 413-FR-008 413-FR-014
  it('sends a heartbeat every 20 seconds', async () => {
    const { fixture } = await render();

    expect(heartbeats()).toHaveLength(1);
    heartbeats()[0]?.run();
    await pause(350);
    await settle(fixture);
    heartbeats()[0]?.run();
    await pause(350);
    await settle(fixture);

    expect(api.verificationFileControllerPresence).toHaveBeenCalledTimes(3);
  });

  // @traces 413-FR-008
  it('reads again when the live stream asks every view to resync', async () => {
    const { fixture } = await render();

    resyncs.next();
    await pause(350);
    await settle(fixture);

    expect(api.verificationFileControllerPresence).toHaveBeenCalledTimes(2);
  });

  // @traces 413-FR-004 413-FR-014
  it('leaves once on destroy with the bearer of the last heartbeat, outliving the page', async () => {
    const { fixture } = await render();
    token = null;

    fixture.destroy();

    expect(leaves()).toEqual([
      [
        `https://api.test/api/v1/admin/verification-files/${FILE}/presence`,
        {
          headers: { Authorization: 'Bearer token-1' },
          keepalive: true,
          method: 'DELETE',
        },
      ],
    ]);
  });

  // @traces 413-FR-004
  it('sends no heartbeat after leaving and ignores one that answers late', async () => {
    let answerLate: (value: unknown) => void = () => undefined;
    const { fixture, host } = await render();
    api.verificationFileControllerPresence.mockReturnValue(
      new Promise((resolve) => {
        answerLate = resolve;
      }),
    );
    heartbeats()[0]?.run();
    const calls = api.verificationFileControllerPresence.mock.calls.length;

    fixture.destroy();
    answerLate({ others: [ANA, ION] });
    await pause(350);
    heartbeats()[0]?.run();
    await pause(350);

    expect(api.verificationFileControllerPresence.mock.calls.length).toBe(
      calls,
    );
    expect(text(host)).not.toContain('Ion');
    expect(leaves()).toHaveLength(1);
  });

  // @traces 413-FR-004
  it('leaves at once and again after the first heartbeat answers when the drawer closes while it is on the wire', async () => {
    let answer: (value: unknown) => void = () => undefined;
    api.verificationFileControllerPresence.mockReturnValue(
      new Promise((resolve) => {
        answer = resolve;
      }),
    );
    const { fixture } = await render();
    token = null;

    fixture.destroy();
    expect(leaves()).toHaveLength(1);
    answer({ others: [] });
    await pause();

    // The beat may land after the first leave: it is left once more.
    expect(leaves()).toHaveLength(2);
    expect(leaves()[1]).toEqual([
      `https://api.test/api/v1/admin/verification-files/${FILE}/presence`,
      {
        headers: { Authorization: 'Bearer token-1' },
        keepalive: true,
        method: 'DELETE',
      },
    ]);
  });

  // @traces 413-FR-004 413-FR-008
  it('does not leave again for a beat that answers after the page came back', async () => {
    let answer: (value: unknown) => void = () => undefined;
    api.verificationFileControllerPresence.mockReturnValue(
      new Promise((resolve) => {
        answer = resolve;
      }),
    );
    await render();
    token = null;

    window.dispatchEvent(new Event('pagehide'));
    window.dispatchEvent(
      Object.assign(new Event('pageshow'), { persisted: true }),
    );
    answer({ others: [] });
    await pause();

    expect(leaves()).toHaveLength(1);
  });

  // @traces 413-FR-004
  it('leaves once when the page hides, and not again on destroy', async () => {
    const { fixture } = await render();

    window.dispatchEvent(new Event('pagehide'));
    window.dispatchEvent(new Event('pagehide'));
    fixture.destroy();

    expect(leaves()).toHaveLength(1);
  });

  // @traces 413-FR-001 413-FR-008
  it('beats again when the page comes back from the back-forward cache', async () => {
    const { fixture, host } = await render();
    window.dispatchEvent(new Event('pagehide'));
    const calls = api.verificationFileControllerPresence.mock.calls.length;

    window.dispatchEvent(
      Object.assign(new Event('pageshow'), { persisted: true }),
    );
    await pause(350);
    await settle(fixture);

    expect(api.verificationFileControllerPresence.mock.calls.length).toBe(
      calls + 1,
    );
    expect(heartbeats()).toHaveLength(2);
    expect(text(banner(host))).toBe('Ana P. are dosarul deschis din 10:42');
    fixture.destroy();
    expect(leaves()).toHaveLength(2);
  });

  // @traces 413-FR-004
  it('sends no leave when no heartbeat ever answered', async () => {
    api.verificationFileControllerPresence.mockRejectedValue(
      new HttpErrorResponse({ status: 503 }),
    );
    const { fixture } = await render();

    fixture.destroy();

    expect(leaves()).toHaveLength(0);
  });

  // @traces 413-FR-004
  it('on the server, arms no heartbeat and sends no leave', async () => {
    const { fixture } = await render({ platform: 'server' });

    fixture.destroy();

    expect(heartbeats()).toHaveLength(0);
    expect(leaves()).toHaveLength(0);
  });
});
