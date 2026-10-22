import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import type {
  EventKind,
  LiveMessage,
  VerificationStatusDto,
} from '@motor-fix/contracts';
import type { MeDto } from '@motor-fix/data-access/models/me-dto';
import { GaragesService } from '@motor-fix/data-access/services/garages.service';
import { I18n } from '@motor-fix/i18n';
import { Overlays } from '@motor-fix/overlays';
import { filter, Subject } from 'rxjs';

import { VerificationProgress } from './verification-progress';
import { Live } from '../live';
import { Session } from '../session';

const GARAGE = 'a3c1e5f7-0000-4000-8000-000000000001';
const SENT_AT = '2027-03-02T08:30:00.000Z';

const TEXT = {
  en: {
    checkIn: 'We check it within 1–2 working days.',
    contact: 'Contact MotorFix',
    loadFailed: 'We could not load the verification status.',
    offMap:
      'The profile stays off the map until it is approved. If something is missing we tell you what, and you can add it without starting over.',
    retry: 'Retry',
  },
  ro: {
    checkIn: 'O verificăm în 1–2 zile lucrătoare.',
    contact: 'Contactează MotorFix',
    loadFailed: 'Nu am putut încărca starea verificării.',
    offMap:
      'Profilul nu apare pe hartă până la aprobare. Dacă lipsește ceva, îți scriem ce anume și poți completa fără să o iei de la capăt.',
    retry: 'Reîncearcă',
  },
} as const;

let events: Subject<LiveMessage>;
let resyncs: Subject<void>;
let live: {
  close: jest.Mock;
  on: (kinds: readonly EventKind[]) => ReturnType<Subject<LiveMessage>['pipe']>;
  open: jest.Mock;
  resync: ReturnType<Subject<void>['asObservable']>;
};
const api = { verificationStatusControllerRead: jest.fn() };
const overlays = { open: jest.fn() };
let me: ReturnType<typeof signal<MeDto | null>>;
let reload: jest.Mock;

const account = (
  role: 'owner' | 'receptionist' | 'mechanic' = 'owner',
  status: 'draft' | 'approved' = 'draft',
) =>
  ({
    garageAccess: [
      { features: {}, garageId: GARAGE, name: 'Atelier Test', role, status },
    ],
    garageId: GARAGE,
    role: role === 'owner' ? 'garage' : role,
  }) as unknown as MeDto;

const answer = (
  value: VerificationStatusDto['status'],
  extra: Partial<VerificationStatusDto> = {},
): VerificationStatusDto => ({
  note: null,
  reason: null,
  requestedItems: [],
  status: value,
  submittedAt: value === 'draft' ? null : SENT_AT,
  ...extra,
});
const failure = () =>
  new HttpErrorResponse({ status: 503, statusText: 'Unavailable' });

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
  role = 'owner',
}: {
  language?: 'ro' | 'en';
  role?: 'owner' | 'receptionist' | 'mechanic';
} = {}) {
  me = signal<MeDto | null>(account(role));
  TestBed.configureTestingModule({
    providers: [
      { provide: GaragesService, useValue: api },
      { provide: Live, useValue: live },
      { provide: Overlays, useValue: overlays },
      { provide: Session, useValue: { current: me, reload, shown: me } },
      provideRouter([]),
    ],
  });
  const i18n = TestBed.inject(I18n);
  await i18n.enter('garage');
  await i18n.enter('public');
  if (language === 'en') await i18n.use('en');
  const fixture = TestBed.createComponent(VerificationProgress);
  await settle(fixture);
  return { fixture, host: fixture.nativeElement as HTMLElement };
}

// An event, then the 300 ms the page waits for a burst to end.
async function emit(
  fixture: Parameters<typeof settle>[0],
  ...kinds: EventKind[]
) {
  for (const kind of kinds) events.next({ id: 'file-1', kind } as LiveMessage);
  await pause(350);
  await settle(fixture);
}

const text = (element: Element | null | undefined) =>
  (element?.textContent ?? '').replace(/\s+/g, ' ').trim();
const stages = (host: HTMLElement) => [
  ...host.querySelectorAll<HTMLElement>('ol.stages > li'),
];
const names = (host: HTMLElement) =>
  stages(host).map((li) => text(li.querySelector('.name')));
const lit = (host: HTMLElement) =>
  stages(host).map((li) => li.classList.contains('lit'));
const current = (host: HTMLElement) =>
  text(host.querySelector('ol.stages > li[aria-current="step"] .name'));
const announced = (host: HTMLElement) =>
  text(host.querySelector('[role="status"]'));
const buttons = (host: HTMLElement) => [
  ...host.querySelectorAll<HTMLButtonElement>('button'),
];
const button = (host: HTMLElement, name: string) =>
  buttons(host).find((b) => text(b) === name) ?? null;

beforeEach(() => {
  events = new Subject<LiveMessage>();
  resyncs = new Subject<void>();
  live = {
    close: jest.fn(),
    on: (kinds) =>
      events.pipe(filter((m) => (kinds as readonly string[]).includes(m.kind))),
    open: jest.fn(),
    resync: resyncs.asObservable(),
  };
  reload = jest.fn(async () => undefined);
  overlays.open.mockReset().mockResolvedValue('cancelled');
  api.verificationStatusControllerRead
    .mockReset()
    .mockResolvedValue(answer('submitted'));
});

afterEach(() => TestBed.resetTestingModule());

describe('the verification page, for the owner', () => {
  // @traces 101-FR-001
  it('leaves the title to the dashboard’s header, reads the garage of the session and puts the two lines under the stages', async () => {
    const { host } = await render();

    expect(api.verificationStatusControllerRead).toHaveBeenCalledTimes(1);
    expect(api.verificationStatusControllerRead).toHaveBeenCalledWith({
      garageId: GARAGE,
    });
    expect(host.querySelector('h1')).toBeNull();
    expect(host.querySelector('mf-verification-stages')).not.toBeNull();
    expect(text(host)).toContain(TEXT.ro.checkIn);
    expect(text(host)).toContain(TEXT.ro.offMap);
  });

  // @traces 101-FR-001
  it('puts the check-in line before the off-map line, once each', async () => {
    const { host } = await render();
    const all = text(host);

    expect(all.indexOf(TEXT.ro.checkIn)).toBeLessThan(
      all.indexOf(TEXT.ro.offMap),
    );
    expect(all.split(TEXT.ro.offMap)).toHaveLength(2);
  });

  // @traces 101-FR-001 101-FR-002
  it('speaks English', async () => {
    const { host } = await render({ language: 'en' });

    expect(host.querySelector('h1')).toBeNull();
    expect(names(host)[0]).toBe('Submitted · 2 Mar 2027');
    expect(text(host)).toContain(TEXT.en.checkIn);
    expect(text(host)).toContain(TEXT.en.offMap);
  });

  // @traces 101-FR-001 101-FR-002 101-FR-012
  it.each([
    ['draft', [false, false, false], '', 'Trimis'],
    ['submitted', [true, false, false], 'Trimis · 2 mart. 2027', null],
    ['in_review', [true, true, false], 'În verificare', null],
    ['more_requested', [true, true, false], 'Cerute completări', null],
    ['rejected', [true, true, false], 'Respins', null],
    ['approved', [true, true, true], 'Aprobat, pe hartă', null],
  ] as const)(
    'lights the stages of a %s read, with the sending day on the first',
    async (status, expected, lead, undated) => {
      api.verificationStatusControllerRead.mockResolvedValue(
        answer(status, {
          reason:
            status === 'rejected' ? { code: 'rar', note: 'Expirată.' } : null,
        }),
      );

      const { host } = await render();

      expect(lit(host)).toEqual(expected);
      expect(current(host)).toBe(lead);
      expect(names(host)[0]).toBe(undated ?? 'Trimis · 2 mart. 2027');
    },
  );

  // @traces 101-FR-009 101-FR-012
  it('shows a skeleton of the stages, hidden from assistive technology, while the first read runs', async () => {
    api.verificationStatusControllerRead.mockReturnValue(
      new Promise(() => undefined),
    );

    const { host } = await render();

    const skeleton = host.querySelector('.skeleton');
    expect(skeleton).not.toBeNull();
    expect(skeleton?.getAttribute('aria-hidden')).toBe('true');
    expect(host.querySelector('ol.stages')).toBeNull();
    expect(host.querySelector('h1')).toBeNull();
  });

  // @traces 101-FR-009
  it('says the first read failed and reads again on Reîncearcă', async () => {
    api.verificationStatusControllerRead.mockRejectedValueOnce(failure());

    const { fixture, host } = await render();

    expect(host.querySelector('ol.stages')).toBeNull();
    expect(host.querySelector('.skeleton')).toBeNull();
    expect(text(host)).toContain(TEXT.ro.loadFailed);

    button(host, TEXT.ro.retry)?.click();
    await settle(fixture);

    expect(api.verificationStatusControllerRead).toHaveBeenCalledTimes(2);
    expect(current(host)).toBe('Trimis · 2 mart. 2027');
    expect(text(host)).not.toContain(TEXT.ro.loadFailed);
  });

  // @traces 101-FR-009
  it('says the first read failed in English', async () => {
    api.verificationStatusControllerRead.mockRejectedValue(failure());

    const { host } = await render({ language: 'en' });

    expect(text(host)).toContain(TEXT.en.loadFailed);
    expect(button(host, TEXT.en.retry)).not.toBeNull();
  });

  // @traces 101-FR-009
  it('keeps the stage shown when a refresh fails, says so and reads again on Reîncearcă', async () => {
    const { fixture, host } = await render();
    api.verificationStatusControllerRead.mockRejectedValueOnce(failure());

    resyncs.next();
    await settle(fixture);

    expect(current(host)).toBe('Trimis · 2 mart. 2027');
    expect(text(host)).toContain('Nu am putut actualiza stadiul.');
    expect(text(host)).not.toContain(TEXT.ro.loadFailed);

    api.verificationStatusControllerRead.mockResolvedValue(answer('in_review'));
    button(host, TEXT.ro.retry)?.click();
    await settle(fixture);

    expect(api.verificationStatusControllerRead).toHaveBeenCalledTimes(3);
    expect(current(host)).toBe('În verificare');
    expect(text(host)).not.toContain('Nu am putut actualiza stadiul.');
  });

  // @traces 101-FR-012
  it('announces nothing on the first load', async () => {
    const { host } = await render();

    const region = host.querySelector('[role="status"]');
    expect(region).not.toBeNull();
    expect(region?.getAttribute('aria-live')).not.toBe('assertive');
    expect(announced(host)).toBe('');
  });

  // @traces 101-FR-010
  it('leaves the live connection to the dashboard', async () => {
    const { fixture } = await render();
    fixture.destroy();

    expect(live.open).not.toHaveBeenCalled();
    expect(live.close).not.toHaveBeenCalled();
  });
});

describe('the verification page, following the file', () => {
  // @traces 101-FR-005 101-FR-012
  it.each([
    'verification.opened',
    'verification.decided',
    'verification.reopened',
  ] as const)(
    'reads again on %s and announces the new stage politely',
    async (kind) => {
      const { fixture, host } = await render();
      api.verificationStatusControllerRead.mockResolvedValue(
        answer('in_review'),
      );

      await emit(fixture, kind);

      expect(api.verificationStatusControllerRead).toHaveBeenCalledTimes(2);
      expect(current(host)).toBe('În verificare');
      expect(announced(host)).toBe('Stadiul verificării: În verificare');
    },
  );

  // @traces 101-FR-005
  it('reads again when the stream reconnects', async () => {
    const { fixture, host } = await render();
    api.verificationStatusControllerRead.mockResolvedValue(answer('in_review'));

    resyncs.next();
    await settle(fixture);

    expect(api.verificationStatusControllerRead).toHaveBeenCalledTimes(2);
    expect(current(host)).toBe('În verificare');
  });

  // @traces 101-FR-005
  it('reads once for a burst of events and shows the newest answer', async () => {
    const { fixture, host } = await render();
    api.verificationStatusControllerRead.mockResolvedValue(
      answer('more_requested', { requestedItems: ['photos'] }),
    );

    await emit(
      fixture,
      'verification.opened',
      'verification.decided',
      'verification.reopened',
    );

    expect(api.verificationStatusControllerRead).toHaveBeenCalledTimes(2);
    expect(current(host)).toBe('Cerute completări');
  });

  // @traces 101-FR-005
  it('does not read again on events of other kinds', async () => {
    const { fixture } = await render();

    await emit(fixture, 'request.created');

    expect(api.verificationStatusControllerRead).toHaveBeenCalledTimes(1);
  });

  // @traces 101-FR-003 208-FR-002
  it('lists what more was asked for in the order the admin chose, with Completează the one button', async () => {
    api.verificationStatusControllerRead.mockResolvedValue(
      answer('more_requested', { requestedItems: ['rar', 'photos'] }),
    );

    const { host } = await render();

    expect(current(host)).toBe('Cerute completări');
    expect([...host.querySelectorAll('.items li')].map(text)).toEqual([
      'Autorizația RAR',
      'Fotografiile',
    ]);
    expect(buttons(host).map(text)).toEqual(['Completează']);
  });

  // @traces 101-FR-004
  it('gives a rejection its reason, the note as written and a button that opens the contact drawer', async () => {
    api.verificationStatusControllerRead.mockResolvedValue(
      answer('rejected', {
        reason: { code: 'rar', note: 'Autorizația a expirat în 2025.' },
      }),
    );

    const { host } = await render();

    expect(current(host)).toBe('Respins');
    expect(text(host.querySelector('.reason'))).toBe('Autorizația RAR');
    expect(text(host.querySelector('.note'))).toBe(
      'Autorizația a expirat în 2025.',
    );
    const contact = button(host, TEXT.ro.contact);
    expect(contact).not.toBeNull();

    contact?.click();

    expect(overlays.open).toHaveBeenCalledTimes(1);
    expect(overlays.open).toHaveBeenCalledWith(expect.any(Function), {
      shape: 'drawer',
      title: 'shell.contact.title',
    });
  });

  // @traces 101-FR-004
  it('names the contact button in English, and shows it for a rejection only', async () => {
    api.verificationStatusControllerRead.mockResolvedValue(
      answer('rejected', { reason: { code: 'other', note: 'x' } }),
    );
    const { fixture, host } = await render({ language: 'en' });
    expect(button(host, TEXT.en.contact)).not.toBeNull();

    api.verificationStatusControllerRead.mockResolvedValue(answer('in_review'));
    await emit(fixture, 'verification.reopened');

    expect(button(host, TEXT.en.contact)).toBeNull();
  });
  // @traces 101-FR-006
  it('leaves the session re-read on an approval to the frame', async () => {
    const { fixture } = await render();
    api.verificationStatusControllerRead.mockResolvedValue(answer('approved'));

    await emit(fixture, 'verification.decided');

    expect(reload).not.toHaveBeenCalled();
  });
});

const NOTE =
  'Fotografiile nu arată atelierul. Adaugă 3 fotografii din interior.';
const asked = (extra: Partial<VerificationStatusDto> = {}) =>
  answer('more_requested', {
    note: NOTE,
    requestedItems: ['photos'],
    ...extra,
  });

describe('the verification page, on a request for more', () => {
  // @traces 208-FR-002
  it('lists the items, gives the note word for word and offers Completează', async () => {
    api.verificationStatusControllerRead.mockResolvedValue(asked());

    const { host } = await render();

    expect(current(host)).toBe('Cerute completări');
    expect([...host.querySelectorAll('.items li')].map(text)).toEqual([
      'Fotografiile',
    ]);
    expect(text(host.querySelector('.note'))).toBe(NOTE);
    const complete = button(host, 'Completează');
    expect(complete).not.toBeNull();
    expect(complete?.hasAttribute('hlmBtn')).toBe(true);
    expect(complete?.getAttribute('type')).toBe('button');
    expect(complete?.disabled).toBe(false);
    expect(complete?.getAttribute('tabindex')).toBeNull();
  });

  // @traces 208-FR-002
  it('says it in English', async () => {
    api.verificationStatusControllerRead.mockResolvedValue(asked());

    const { host } = await render({ language: 'en' });

    expect(current(host)).toBe('More details requested');
    expect([...host.querySelectorAll('.items li')].map(text)).toEqual([
      'The photos',
    ]);
    expect(text(host.querySelector('.note'))).toBe(NOTE);
    expect(button(host, 'Complete')).not.toBeNull();
  });

  // @traces 208-FR-002
  it('shows the note and the button with no list when no item was named', async () => {
    api.verificationStatusControllerRead.mockResolvedValue(
      asked({ requestedItems: [] }),
    );

    const { host } = await render();

    expect(host.querySelector('.items')).toBeNull();
    expect(text(host.querySelector('.note'))).toBe(NOTE);
    expect(button(host, 'Completează')).not.toBeNull();
  });

  // @traces 208-FR-002
  it('opens the listing form on Completează', async () => {
    api.verificationStatusControllerRead.mockResolvedValue(asked());
    const { host } = await render();
    const navigate = jest
      .spyOn(TestBed.inject(Router), 'navigateByUrl')
      .mockResolvedValue(true);

    button(host, 'Completează')?.click();

    expect(navigate).toHaveBeenCalledTimes(1);
    expect(String(navigate.mock.calls[0]?.[0])).toBe('/list-your-garage');
  });

  // @traces 208-FR-002
  it.each(['submitted', 'in_review', 'rejected', 'approved'] as const)(
    'offers no note and no Completează on a %s file',
    async (status) => {
      api.verificationStatusControllerRead.mockResolvedValue(
        answer(status, {
          reason:
            status === 'rejected' ? { code: 'rar', note: 'Expirată.' } : null,
        }),
      );

      const { host } = await render();

      expect(button(host, 'Completează')).toBeNull();
      expect(text(host)).not.toContain(NOTE);
    },
  );

  // @traces 208-FR-002
  it('brings the request to an open page on a decision, without a reload', async () => {
    const { fixture, host } = await render();
    expect(button(host, 'Completează')).toBeNull();
    api.verificationStatusControllerRead.mockResolvedValue(asked());

    await emit(fixture, 'verification.decided');

    expect(text(host.querySelector('.note'))).toBe(NOTE);
    expect(button(host, 'Completează')).not.toBeNull();
  });

  // @traces 208-FR-009
  it('reads again when the file is sent again and shows Trimis with no request', async () => {
    api.verificationStatusControllerRead.mockResolvedValue(asked());
    const { fixture, host } = await render();
    const resent = '2027-03-09T10:00:00.000Z';
    api.verificationStatusControllerRead.mockResolvedValue(
      answer('submitted', { submittedAt: resent }),
    );

    const started = Date.now();
    await emit(fixture, 'verification.submitted');

    expect(Date.now() - started).toBeLessThan(5000);
    expect(api.verificationStatusControllerRead).toHaveBeenCalledTimes(2);
    expect(current(host)).toBe('Trimis · 9 mart. 2027');
    expect(button(host, 'Completează')).toBeNull();
    expect(host.querySelector('.note')).toBeNull();
  });
});

describe('the verification page, for the garage staff', () => {
  // @traces 101-FR-008
  it.each(['receptionist', 'mechanic'] as const)(
    'gives a %s the two lines under the header’s title, and never reads the status',
    async (role) => {
      const { fixture, host } = await render({ role });
      resyncs.next();
      await emit(fixture, 'verification.decided');

      expect(host.querySelector('h1')).toBeNull();
      expect(text(host)).toContain(TEXT.ro.checkIn);
      expect(text(host)).toContain(TEXT.ro.offMap);
      expect(host.querySelector('ol.stages')).toBeNull();
      expect(host.querySelector('.skeleton')).toBeNull();
      expect(text(host)).not.toContain(TEXT.ro.loadFailed);
      expect(api.verificationStatusControllerRead).not.toHaveBeenCalled();
    },
  );

  // @traces 208-FR-002
  it.each(['receptionist', 'mechanic'] as const)(
    'gives a %s no note and no Completează while more is asked for',
    async (role) => {
      api.verificationStatusControllerRead.mockResolvedValue(asked());

      const { host } = await render({ role });

      expect(button(host, 'Completează')).toBeNull();
      expect(text(host)).not.toContain(NOTE);
      expect(host.querySelector('.items')).toBeNull();
    },
  );

  // @traces 101-FR-008
  it('says it in English', async () => {
    const { host } = await render({ language: 'en', role: 'mechanic' });

    expect(host.querySelector('h1')).toBeNull();
    expect(text(host)).toContain(TEXT.en.checkIn);
    expect(text(host)).toContain(TEXT.en.offMap);
  });
});

describe('the verification page on a phone', () => {
  const css = () =>
    readFileSync(join(__dirname, 'verification-progress.css'), 'utf8');

  // @traces 101-FR-012
  it('makes its buttons Cockpit buttons, reachable by keyboard', async () => {
    api.verificationStatusControllerRead.mockRejectedValueOnce(failure());
    const first = await render();
    const retry = button(first.host, TEXT.ro.retry);
    expect(retry?.hasAttribute('hlmBtn')).toBe(true);
    expect(retry?.getAttribute('type')).toBe('button');
    expect(retry?.disabled).toBe(false);
    expect(retry?.getAttribute('tabindex')).toBeNull();
    TestBed.resetTestingModule();

    api.verificationStatusControllerRead.mockResolvedValue(
      answer('rejected', { reason: { code: 'rar', note: 'n' } }),
    );
    const rejected = await render();
    const contact = button(rejected.host, TEXT.ro.contact);
    expect(contact?.hasAttribute('hlmBtn')).toBe(true);
    expect(contact?.getAttribute('tabindex')).toBeNull();
  });

  // @traces 101-FR-012
  it('keeps its buttons a thumb tall, wraps a long note in the column and stops the pulse for reduced motion', () => {
    const sheet = css();

    expect(sheet).toMatch(/button[^{]*\{[^}]*min-height: var\(--mf-tap\)/);
    expect(sheet).toMatch(/overflow-wrap: anywhere/);
    expect(sheet).toMatch(/min-width: 0/);
    expect(sheet).toMatch(/@media \(prefers-reduced-motion: reduce\)/);
  });

  // @traces 101-FR-012
  it('lays the page out in one column with no fixed width', () => {
    const sheet = css();

    expect(sheet).toMatch(/:host \{[^}]*display: grid/);
    expect(sheet).toMatch(/gap: var\(--mf-space-3\)/);
    expect(sheet).not.toMatch(/\bwidth: \d+px/);
  });
});
