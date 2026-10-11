import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { Component, input, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import type { GarageRequestSummaryDto, MeDto } from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';
import { Overlays } from '@motor-fix/overlays';

import { GarageRequestRow } from './garage-request-row';
import { Session } from '../../session';
import { DeclineRequestDialog } from '../decline-request-dialog/decline-request-dialog';
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
      provideRouter([]),
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
  const navigate = jest
    .spyOn(TestBed.inject(Router), 'navigate')
    .mockResolvedValue(true);
  const settle = async () => {
    for (let i = 0; i < 3; i++) {
      await wait(0);
      fixture.detectChanges();
    }
  };
  return { element, navigate, settle };
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

// @traces 345-FR-013
// @traces 345-FR-015
describe('the request row’s Refuză button', () => {
  it.each([
    ['owner', false],
    ['receptionist', false],
    ['mechanic', true],
  ] as const)(
    'shows next to Trimite oferta for a %s (can answer quotes: %s)',
    async (role, can) => {
      const { element } = await render(me(role, can));

      const names = [...element.querySelectorAll('.actions button')].map((b) =>
        b.textContent?.trim(),
      );
      expect(names).toEqual(['Trimite oferta', 'Refuză']);
    },
  );

  it('is outlined like the board’s ghost button (1 px strong line), not bare text', async () => {
    const { element } = await render(me('owner', false));

    const decline = sendButton(element, 'Refuză');
    expect(decline?.classList).toContain('spartan-button-variant-secondary');
    expect(decline?.classList).not.toContain('spartan-button-variant-ghost');
  });

  it('is absent for a mechanic without can_answer_quotes, on a closed row and on an answered one', async () => {
    const plain = await render(me('mechanic', false));
    expect(sendButton(plain.element, 'Refuză')).toBeUndefined();
    TestBed.resetTestingModule();

    const closed = await render(me('owner'), {
      row: requestRow({
        closedAt: new Date().toISOString(),
        closedReason: 'declined',
      }),
    });
    expect(sendButton(closed.element, 'Refuză')).toBeUndefined();
  });

  it('reads Decline in English', async () => {
    const { element } = await render(me('owner'), { language: 'en' });

    expect(sendButton(element, 'Decline')).toBeDefined();
  });

  it('opens the decline dialog with the driver and the car', async () => {
    const { element, settle } = await render(me('owner'));

    sendButton(element, 'Refuză')?.click();
    await settle();

    expect(open).toHaveBeenCalledWith(DeclineRequestDialog, {
      data: {
        car: 'Dacia Logan · 2018',
        driver: 'Vlad P.',
        requestId: 'req-1',
      },
      shape: 'dialog',
      title: 'garage.requests.decline.title',
    });
  });

  it.each(['declined', 'refused'])(
    're-reads the lists at once after a %s answer',
    async (answer) => {
      const { element, settle } = await render(me('owner'));
      open.mockResolvedValueOnce(answer);

      sendButton(element, 'Refuză')?.click();
      await settle();

      expect(reload).toHaveBeenCalledTimes(1);
    },
  );

  it('re-reads nothing when the dialog is cancelled', async () => {
    const { element, settle } = await render(me('owner'));

    sendButton(element, 'Refuză')?.click();
    await settle();

    expect(reload).not.toHaveBeenCalled();
  });
});

// @traces 345-FR-012
describe('a declined row', () => {
  it.each([
    ['ro', 'Refuzată'],
    ['en', 'Declined'],
  ] as const)('says why it closed in %s', async (language, label) => {
    const { element } = await render(me('owner'), {
      language,
      row: requestRow({
        closedAt: new Date().toISOString(),
        closedReason: 'declined',
        recipient: {
          answeredAt: new Date().toISOString(),
          declinedAt: new Date().toISOString(),
          declineReason: 'fully_booked',
          source: 'search',
          status: 'declined',
        },
      }),
    });

    expect(element.querySelector('.reason')?.textContent?.trim()).toBe(label);
    expect(element.querySelector('.actions')).toBeNull();
  });
});

// @traces 347-FR-001
describe('opening a request from its row', () => {
  const opener = (element: HTMLElement) =>
    element.querySelector<HTMLButtonElement>('button.open');

  it('offers a button named after the customer and the car on a waiting row', async () => {
    const { element } = await render(me('owner'));

    expect(opener(element)?.getAttribute('type')).toBe('button');
    expect(opener(element)?.getAttribute('aria-label')).toBe(
      'Deschide cererea Vlad P. · Dacia Logan · 2018',
    );
  });

  it('reads Open the request in English', async () => {
    const { element } = await render(me('owner'), { language: 'en' });

    expect(opener(element)?.getAttribute('aria-label')).toBe(
      'Open the request Vlad P. · Dacia Logan · 2018',
    );
  });

  it('goes to the request’s address, carrying where it came from', async () => {
    const { element, navigate, settle } = await render(me('owner'));

    opener(element)?.click();
    await settle();

    expect(navigate).toHaveBeenCalledWith(['/app/garage/requests', 'req-1'], {
      state: { origin: '/' },
    });
  });

  it('is absent on a closed row and for a mechanic who may not answer quotes', async () => {
    const closed = await render(me('owner'), {
      row: requestRow({
        closedAt: new Date().toISOString(),
        closedReason: 'cancelled',
      }),
    });
    expect(opener(closed.element)).toBeNull();
    TestBed.resetTestingModule();

    const plain = await render(me('mechanic', false));
    expect(opener(plain.element)).toBeNull();
  });

  it.each(['Trimite oferta', 'Refuză'])(
    'leaves the address alone when %s is clicked',
    async (name) => {
      const { element, navigate, settle } = await render(me('owner'));

      sendButton(element, name)?.click();
      await settle();

      expect(open).toHaveBeenCalledTimes(1);
      expect(navigate).not.toHaveBeenCalled();
    },
  );
});

// The PR tester measured the open button drawn over Trimite oferta and
// Refuză (two controls in one place) and the row's gaps off the 4 px grid.
describe('the request row’s layout', () => {
  const css = readFileSync(join(__dirname, 'garage-request-row.css'), 'utf8');
  const rule = (selector: string) =>
    [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)]
      .filter(([, head]) => head.trim() === selector)
      .map(([, , body]) => body)
      .join(';');

  it('lays the open button over the row’s text only, never over its buttons', () => {
    expect(rule('.open')).not.toMatch(/position:\s*absolute/);
    expect(rule('.open')).toMatch(/grid-area:\s*1\s*\/\s*1\s*\/\s*2\s*\/\s*4/);
    expect(rule('.actions')).toMatch(/grid-area:\s*1\s*\/\s*4/);
  });

  it('sets the car, mechanic and age at body size on a phone', () => {
    const phone = css.slice(css.indexOf('@media (max-width: 767.98px)'));
    expect(phone).toMatch(
      /\.car,\s*\.when\s*\{\s*font-size:\s*var\(--mf-size-body\);/,
    );
  });

  // Lap 4: at 320 px Trimite oferta wrapped one word per line and Refuză
  // dropped to a line of its own beside nothing.
  it('stacks Trimite oferta and Refuză full width on a phone, the row unpadded at the sides', () => {
    const phone = css.slice(css.indexOf('@media (max-width: 767.98px)'));
    expect(phone).toMatch(/:host\s*\{[^}]*padding-inline:\s*0;/);
    expect(phone).toMatch(
      /\.actions\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\);/,
    );
    expect(phone).toMatch(
      /\.actions button\s*\{[^}]*width:\s*100%;[^}]*padding-inline:\s*var\(--mf-space-3\);/,
    );
  });

  it('spaces the row and its lines on the 4 px grid', () => {
    for (const [, value] of css.matchAll(/(?:gap|padding):\s*([^;]+);/g))
      for (const px of value.match(/\d+(?:\.\d+)?px/g) ?? [])
        expect(Number.parseFloat(px) % 4).toBe(0);
    expect(rule('.open')).toMatch(/padding:\s*0/);
  });
});
