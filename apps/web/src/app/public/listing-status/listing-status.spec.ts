import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type {
  EventKind,
  LiveMessage,
  VerificationStatusDto,
} from '@motor-fix/contracts';
import { GaragesService } from '@motor-fix/data-access/services/garages.service';
import { I18n } from '@motor-fix/i18n';
import { filter, Subject } from 'rxjs';

import { ListingStatus } from './listing-status';
import { Live } from '../../dashboard/live';
import { Session } from '../../dashboard/session';

const GARAGE = 'a3c1e5f7-0000-4000-8000-000000000001';

const events = new Subject<LiveMessage>();
const resyncs = new Subject<void>();
const live = {
  close: jest.fn(),
  on: (kinds: readonly EventKind[]) =>
    events.pipe(filter((m) => kinds.includes(m.kind as EventKind))),
  open: jest.fn(),
  resync: resyncs.asObservable(),
};
const api = { verificationStatusControllerRead: jest.fn() };
const session = {
  current: signal({
    garageAccess: [{ garageId: GARAGE, role: 'owner' }],
    garageId: GARAGE,
    role: 'garage',
  }),
};

const status = (
  value: VerificationStatusDto['status'],
  extra: Partial<VerificationStatusDto> = {},
): VerificationStatusDto => ({
  reason: null,
  requestedItems: [],
  status: value,
  submittedAt: '2026-10-20T08:30:00.000Z',
  ...extra,
});
const failure = () =>
  new HttpErrorResponse({ status: 503, statusText: 'Unavailable' });

const pause = (ms = 1) => new Promise((resolve) => setTimeout(resolve, ms));

async function render(
  inputs: { sent?: VerificationStatusDto['status'] | null } = {},
  language: 'ro' | 'en' = 'ro',
) {
  TestBed.configureTestingModule({
    providers: [
      { provide: GaragesService, useValue: api },
      { provide: Live, useValue: live },
      { provide: Session, useValue: session },
    ],
  });
  const i18n = TestBed.inject(I18n);
  await i18n.enter('public');
  if (language === 'en') await i18n.use('en');
  const fixture = TestBed.createComponent(ListingStatus);
  for (const [key, value] of Object.entries(inputs))
    fixture.componentRef.setInput(key, value);
  await settle(fixture);
  return { fixture, host: fixture.nativeElement as HTMLElement };
}

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

const text = (element: Element | null | undefined) =>
  (element?.textContent ?? '').replace(/\s+/g, ' ').trim();
const lit = (host: HTMLElement) =>
  [...host.querySelectorAll('ol.stages > li')].map((li) =>
    li.classList.contains('lit'),
  );
const secondStage = (host: HTMLElement) =>
  text(host.querySelector('ol.stages > li:nth-child(2) .name'));
const failedLine = (host: HTMLElement) => host.querySelector('.refresh-failed');
const retry = (host: HTMLElement) =>
  failedLine(host)?.querySelector<HTMLButtonElement>('button') ?? null;
const announced = (host: HTMLElement) =>
  text(host.querySelector('[role="status"]'));

beforeEach(() => {
  live.open.mockReset();
  live.close.mockReset();
  api.verificationStatusControllerRead
    .mockReset()
    .mockResolvedValue(status('submitted'));
});

afterEach(() => TestBed.resetTestingModule());

describe('the listing status', () => {
  // @traces 116-FR-015
  it("reads the garage's status once and lights its stage", async () => {
    api.verificationStatusControllerRead.mockResolvedValue(status('in_review'));

    const { host } = await render();

    expect(api.verificationStatusControllerRead).toHaveBeenCalledTimes(1);
    expect(api.verificationStatusControllerRead).toHaveBeenCalledWith({
      garageId: GARAGE,
    });
    expect(lit(host)).toEqual([true, true, false]);
    expect(failedLine(host)).toBeNull();
  });

  // @traces 116-FR-015
  it('lists what a request for more asks for under the second stage', async () => {
    api.verificationStatusControllerRead.mockResolvedValue(
      status('more_requested', { requestedItems: ['photos'] }),
    );

    const { host } = await render();

    expect(secondStage(host)).toBe('Cerute completări');
    expect(text(host.querySelector('ol.stages .items'))).toBe('Fotografiile');
  });

  // @traces 116-FR-015
  it('shows what the send answered until the first read comes back', async () => {
    api.verificationStatusControllerRead.mockReturnValue(
      new Promise(() => undefined),
    );

    const { host } = await render({ sent: 'submitted' });

    expect(lit(host)).toEqual([true, false, false]);
  });

  // @traces 116-FR-016
  it('opens the live stream while shown and closes it after', async () => {
    const { fixture } = await render();
    expect(live.open).toHaveBeenCalledTimes(1);

    fixture.destroy();

    expect(live.close).toHaveBeenCalledTimes(1);
  });

  // @traces 116-FR-016 116-FR-015
  it.each([
    'verification.opened',
    'verification.decided',
    'verification.reopened',
  ] as const)('reads again on %s and announces the new stage', async (kind) => {
    const { fixture, host } = await render();
    api.verificationStatusControllerRead.mockResolvedValue(
      status('rejected', {
        reason: { code: 'documents', note: 'Certificatul nu se citește.' },
      }),
    );

    events.next({ id: 'f1', kind } as LiveMessage);
    await pause(350);
    await settle(fixture);

    expect(api.verificationStatusControllerRead).toHaveBeenCalledTimes(2);
    expect(secondStage(host)).toBe('Respins');
    expect(text(host.querySelector('ol.stages .note'))).toBe(
      'Certificatul nu se citește.',
    );
    expect(announced(host)).toContain('Respins');
  });

  // @traces 116-FR-016
  it('does not read again on events of other kinds', async () => {
    const { fixture } = await render();

    events.next({ id: 'r1', kind: 'request.created' } as LiveMessage);
    await pause(350);
    await settle(fixture);

    expect(api.verificationStatusControllerRead).toHaveBeenCalledTimes(1);
  });

  // @traces 116-FR-016
  it('reads again when the stream reconnects', async () => {
    const { fixture, host } = await render();
    api.verificationStatusControllerRead.mockResolvedValue(status('approved'));

    resyncs.next();
    await settle(fixture);

    expect(api.verificationStatusControllerRead).toHaveBeenCalledTimes(2);
    expect(lit(host)).toEqual([true, true, true]);
  });

  // @traces 116-FR-021
  it('keeps the stage on a failed re-read, says it could not refresh and retries on the press', async () => {
    const { fixture, host } = await render();
    api.verificationStatusControllerRead.mockRejectedValueOnce(failure());

    resyncs.next();
    await settle(fixture);

    expect(lit(host)).toEqual([true, false, false]);
    expect(text(failedLine(host))).toContain('Nu am putut actualiza stadiul.');
    expect(text(retry(host))).toBe('Reîncearcă');

    api.verificationStatusControllerRead.mockResolvedValue(status('in_review'));
    retry(host)?.click();
    await settle(fixture);

    expect(api.verificationStatusControllerRead).toHaveBeenCalledTimes(3);
    expect(lit(host)).toEqual([true, true, false]);
    expect(failedLine(host)).toBeNull();
  });

  // @traces 116-FR-021
  it('shows only the line and the retry when the first read fails', async () => {
    api.verificationStatusControllerRead.mockRejectedValue(failure());

    const { host } = await render();

    expect(host.querySelector('ol.stages')).toBeNull();
    expect(text(failedLine(host))).toContain('Nu am putut actualiza stadiul.');
    expect(retry(host)).not.toBeNull();
  });

  // @traces 116-FR-021
  it('reads again on the next event after a failure', async () => {
    api.verificationStatusControllerRead.mockRejectedValueOnce(failure());
    const { fixture, host } = await render();

    events.next({ id: 'f1', kind: 'verification.opened' } as LiveMessage);
    await pause(350);
    await settle(fixture);

    expect(failedLine(host)).toBeNull();
    expect(lit(host)).toEqual([true, false, false]);
  });

  // @traces 116-FR-021
  it('says it in English', async () => {
    api.verificationStatusControllerRead.mockRejectedValue(failure());

    const { host } = await render({}, 'en');

    expect(text(failedLine(host))).toContain('Could not refresh the status.');
    expect(text(retry(host))).toBe('Retry');
  });
});
