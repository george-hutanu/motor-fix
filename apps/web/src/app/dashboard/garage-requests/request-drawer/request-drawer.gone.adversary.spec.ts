import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  type GarageRequestDto,
  GarageRequestsService,
  type MeDto,
} from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';
import { OVERLAY_TASK, Overlays } from '@motor-fix/overlays';

import { RequestDrawer } from './request-drawer';
import { Live } from '../../live';
import { Session } from '../../session';
import { fakeLive, wait } from '../garage-requests.testing';

const detail = (over: Partial<GarageRequestDto> = {}): GarageRequestDto =>
  ({
    booking: null,
    car: {
      brand: 'BMW',
      engine: '2.0',
      fuel: 'petrol',
      model: '330i',
      year: 2021,
    },
    closedAt: null,
    closedReason: null,
    createdAt: new Date(Date.now() - 60_000).toISOString(),
    description: 'Scârțâie la frânare.',
    descriptionLine: 'Scârțâie la frânare.',
    driver: { shortName: 'Vlad P.' },
    expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    id: 'req-1',
    jobs: [
      {
        id: 'rj-1',
        jobTypeId: 'j',
        nameEn: 'Front brakes',
        nameRo: 'Frâne față',
        offered: true,
        position: 0,
        price: { durationMinutes: 120, fromBani: 70_000, toBani: 100_000 },
      },
    ],
    quote: null,
    recipient: {
      answeredAt: null,
      declinedAt: null,
      declineReason: null,
      source: 'search',
      status: 'waiting',
    },
    status: 'sent',
    ...over,
  }) as GarageRequestDto;

const owner = {
  capabilities: ['garage.requests'],
  garageAccess: [
    {
      features: {},
      garageId: 'garage-1',
      name: 'S',
      permissions: {
        canAnswerQuotes: false,
        canMoveBookings: false,
        canRecordFinalPrice: false,
      },
      role: 'owner',
      status: 'approved',
    },
  ],
  garageId: 'garage-1',
} as unknown as MeDto;

const httpError = (status: number) =>
  new HttpErrorResponse({ error: { code: 'x' }, status });

let read: jest.Mock;
let open: jest.Mock;
let live: ReturnType<typeof fakeLive>;

async function render(first: GarageRequestDto | HttpErrorResponse = detail()) {
  read = jest.fn(async () => {
    if (first instanceof HttpErrorResponse) throw first;
    return first;
  });
  open = jest.fn(async () => 'cancelled');
  live = fakeLive();
  const me = signal(owner);
  TestBed.configureTestingModule({
    providers: [
      { provide: Live, useValue: live },
      { provide: Session, useValue: { current: me, shown: me } },
      { provide: Overlays, useValue: { open } },
      {
        provide: GarageRequestsService,
        useValue: { garageRequestsControllerGet: read },
      },
      {
        provide: OVERLAY_TASK,
        useValue: {
          close: jest.fn(),
          data: { id: 'req-1' },
          markUnchanged: jest.fn(),
        },
      },
    ],
  });
  await TestBed.inject(I18n).enter('garage');
  const fixture = TestBed.createComponent(RequestDrawer);
  const element = fixture.nativeElement as HTMLElement;
  const settle = async () => {
    for (let i = 0; i < 4; i++) {
      fixture.detectChanges();
      await fixture.whenStable();
      await wait(0);
    }
  };
  await settle();
  const reread = async (
    answer: 'gone' | 'ok' | 500 | 403 | GarageRequestDto,
  ) => {
    if (answer === 'gone') read.mockRejectedValueOnce(httpError(404));
    else if (answer === 500 || answer === 403)
      read.mockRejectedValueOnce(httpError(answer));
    else read.mockResolvedValueOnce(answer === 'ok' ? detail() : answer);
    live.emit('request.cancelled', 'req-1');
    await wait(350);
    await settle();
  };
  return { element, reread, settle };
}

const text = (el: Element | null | undefined) =>
  (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
const buttons = (element: HTMLElement) =>
  [...element.querySelectorAll('button')].filter((b) =>
    ['Trimite oferta', 'Refuză'].includes(text(b)),
  );

afterEach(() => TestBed.resetTestingModule());

describe('the request drawer against hostile 404 sequences', () => {
  // @traces 588-FR-006
  it('keeps one banner and everything shown when two re-reads in a row answer 404', async () => {
    const { element, reread } = await render();

    await reread('gone');
    await reread('gone');

    expect(element.querySelectorAll('[role="status"]')).toHaveLength(1);
    expect(text(element.querySelector('[role="status"]'))).toBe(
      'Nu mai este disponibil',
    );
    expect(text(element)).toContain('Scârțâie la frânare.');
    expect(text(element)).toContain('Frâne față');
  });

  // @traces 588-FR-006
  it('does not press Trimite oferta or Refuză once gone', async () => {
    const { element, reread } = await render();
    await reread('gone');

    const found = buttons(element);
    expect(found).toHaveLength(2);
    found.forEach((b) => {
      b.click();
    });
    await wait(0);

    expect(open).not.toHaveBeenCalled();
  });

  // @traces 588-FR-006
  it('shows the offline line beside the gone banner when both hold', async () => {
    const { element, reread, settle } = await render();
    await reread('gone');

    live.offline.set(true);
    await settle();

    expect(text(element.querySelector('.offline'))).not.toBe('');
    expect(text(element.querySelector('.banner'))).toBe(
      'Nu mai este disponibil',
    );
  });

  // @traces 588-FR-006
  it('shows one gone banner over an accepted quote', async () => {
    const accepted = detail({
      quote: { status: 'accepted' } as GarageRequestDto['quote'],
    });
    const { element, reread } = await render(accepted);

    await reread('gone');

    expect(element.querySelectorAll('[role="status"]')).toHaveLength(1);
    expect(text(element.querySelector('.banner'))).toBe(
      'Nu mai este disponibil',
    );
  });

  // @traces 588-FR-006
  it('does not say gone when a re-read fails with a server error, and keeps the detail', async () => {
    const { element, reread } = await render();

    await reread(500);

    expect(text(element)).not.toContain('Nu mai este disponibil');
    expect(text(element)).toContain('Vlad P.');
  });

  // @traces 588-FR-006
  it('does not say gone when a re-read answers 403', async () => {
    const { element, reread } = await render();

    await reread(403);

    expect(text(element)).not.toContain('Nu mai este disponibil');
  });

  // @traces 588-FR-008
  it('drops the banner when the request comes back, closed with a reason, and shows that reason', async () => {
    const { element, reread } = await render();
    await reread('gone');

    await reread(
      detail({
        closedReason: 'cancelled',
        recipient: { ...detail().recipient, status: 'closed' },
      }),
    );

    expect(element.querySelectorAll('[role="status"]')).toHaveLength(1);
    expect(text(element.querySelector('[role="status"]'))).not.toBe(
      'Nu mai este disponibil',
    );
  });

  // @traces 588-FR-007
  it('shows the refusal alone when the first read is gone and a later read answers', async () => {
    const { element, reread } = await render(httpError(404));
    expect(text(element)).toContain('Cererea nu mai este disponibilă');

    await reread('ok');

    expect(text(element)).not.toContain('Nu mai este disponibil ');
    expect(element.querySelector('.banner')).toBeNull();
  });

  // @traces 588-FR-007
  it('shows the refusal, not the banner, when a first 404 repeats', async () => {
    const { element, reread } = await render(httpError(404));

    await reread('gone');

    expect(text(element)).toContain('Cererea nu mai este disponibilă');
    expect(element.querySelector('.banner')).toBeNull();
    expect(element.querySelector('dl')).toBeNull();
  });
});
