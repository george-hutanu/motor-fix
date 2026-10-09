import { Component, input, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { GarageRequestSummaryDto, MeDto } from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';
import { Overlays } from '@motor-fix/overlays';

import { GarageRequestRow } from './garage-request-row';
import { Session } from '../../session';
import { requestRow, wait } from '../garage-requests.testing';
import { GarageRequestsFeed } from '../garage-requests-feed';
import { SendQuoteDialog } from '../send-quote-dialog/send-quote-dialog';

@Component({
  imports: [GarageRequestRow],
  template: '<ul><li [mfGarageRequestRow]="row()"></li></ul>',
})
class Host {
  readonly row = input.required<GarageRequestSummaryDto>();
}

type Role = 'owner' | 'receptionist' | 'mechanic';

const me = (role: Role, canAnswerQuotes = false) =>
  ({
    capabilities: ['garage.requests'],
    garageAccess: [
      {
        features: {},
        garageId: 'garage-1',
        name: 'Service Auto',
        permissions: {
          canAnswerQuotes,
          canMoveBookings: false,
          canRecordFinalPrice: false,
        },
        role,
        status: 'approved',
      },
    ],
    garageId: 'garage-1',
  }) as unknown as MeDto;

let open: jest.Mock;
let reload: jest.Mock;
let sent: jest.Mock;

async function render(
  account: MeDto,
  { row = requestRow(), language = 'ro' } = {} as {
    row?: GarageRequestSummaryDto;
    language?: 'ro' | 'en';
  },
) {
  const shown = signal(account);
  open = jest.fn(async () => 'cancelled');
  reload = jest.fn();
  sent = jest.fn();
  TestBed.configureTestingModule({
    providers: [
      { provide: Session, useValue: { current: shown, shown } },
      { provide: Overlays, useValue: { open } },
      { provide: GarageRequestsFeed, useValue: { reload, sent } },
    ],
  });
  await TestBed.inject(I18n).enter('garage');
  if (language === 'en') await TestBed.inject(I18n).use('en');
  const fixture = TestBed.createComponent(Host);
  fixture.componentRef.setInput('row', row);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  const element = fixture.nativeElement as HTMLElement;
  const settle = async () => {
    for (let i = 0; i < 3; i++) {
      await wait(0);
      fixture.detectChanges();
    }
  };
  return { element, settle };
}

const sendButton = (element: HTMLElement, name = 'Trimite oferta') =>
  [...element.querySelectorAll('button')].find(
    (b) => b.textContent?.trim() === name,
  );

afterEach(() => TestBed.resetTestingModule());

// @traces 344-FR-009
describe('the request row’s Trimite oferta button', () => {
  it.each([
    ['owner', false],
    ['receptionist', false],
    ['mechanic', true],
  ] as const)('shows for a %s (can answer quotes: %s)', async (role, can) => {
    const { element } = await render(me(role, can));

    expect(sendButton(element)).toBeDefined();
  });

  it('is absent for a mechanic without can_answer_quotes', async () => {
    const { element } = await render(me('mechanic', false));

    expect(sendButton(element)).toBeUndefined();
  });

  it('is absent on a closed row and on a row already answered', async () => {
    const closed = await render(me('owner'), {
      row: requestRow({
        closedAt: new Date().toISOString(),
        closedReason: 'cancelled',
      }),
    });
    expect(sendButton(closed.element)).toBeUndefined();
    TestBed.resetTestingModule();

    const answered = await render(me('owner'), {
      row: requestRow({
        recipient: {
          answeredAt: new Date().toISOString(),
          declinedAt: null,
          declineReason: null,
          source: 'search',
          status: 'quoted',
        },
      }),
    });
    expect(sendButton(answered.element)).toBeUndefined();
  });

  it('reads Send a quote in English', async () => {
    const { element } = await render(me('owner'), { language: 'en' });

    expect(sendButton(element, 'Send a quote')).toBeDefined();
  });

  it('opens the send dialog for the row’s request', async () => {
    const { element, settle } = await render(me('owner'));

    sendButton(element)?.click();
    await settle();

    expect(open).toHaveBeenCalledWith(SendQuoteDialog, {
      data: { requestId: 'req-1' },
      shape: 'dialog',
      title: 'garage.quotes.send.title',
    });
    expect(reload).not.toHaveBeenCalled();
  });

  it('re-reads the lists at once after a refused send', async () => {
    const { element, settle } = await render(me('owner'));
    open.mockResolvedValueOnce('refused');

    sendButton(element)?.click();
    await settle();

    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('tells the lists its quote was sent here, so the row shows at once', async () => {
    const { element, settle } = await render(me('owner'));
    open.mockResolvedValueOnce('sent');

    sendButton(element)?.click();
    await settle();

    expect(sent).toHaveBeenCalledWith('req-1');
  });
});
