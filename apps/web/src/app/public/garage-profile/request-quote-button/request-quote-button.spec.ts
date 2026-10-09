import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  ActivatedRoute,
  convertToParamMap,
  provideRouter,
} from '@angular/router';
import type { PublicGarageDto, RequestDto } from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';
import { Overlays } from '@motor-fix/overlays';

import { RequestQuoteButton } from './request-quote-button';
import { Session } from '../../../dashboard/session';
import type { RequestQuoteData } from '../request-quote/request-quote';

const GARAGE: PublicGarageDto = {
  brand: { id: 'b-1', name: 'Dacia', slug: 'dacia', stance: 'works_on' },
  brandNote: null,
  doesNotTake: [],
  id: 'g-militari',
  jobTypes: [],
  name: 'Service Auto Militari',
  paymentMethods: { card: false, cash: false, transfer: false },
  rating: null,
  refusalPhrase: null,
  reviewCount: 0,
  slug: 'service-auto-militari',
  verifiedAt: null,
  worksOn: [],
};

const request = (names: string[]) =>
  ({
    id: 'req-1',
    recipients: names.map((name, i) => ({
      garage: { id: `g-${i}`, name, slug: `g-${i}` },
    })),
  }) as unknown as RequestDto;

let open: jest.Mock;

async function render(
  options: {
    garage?: PublicGarageDto;
    role?: 'driver' | 'garage' | 'mechanic' | 'admin' | null;
    query?: Record<string, string>;
    answer?: RequestDto | 'cancelled';
  } = {},
) {
  open = jest.fn(
    async (_task: unknown, { data }: { data: RequestQuoteData }) => {
      const answer = options.answer ?? 'cancelled';
      if (answer !== 'cancelled') data.sent?.(answer);
      return answer;
    },
  );
  const role = options.role === undefined ? null : options.role;
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      { provide: Overlays, useValue: { open } },
      {
        provide: Session,
        useValue: { current: signal(role ? { role } : null) },
      },
      {
        provide: ActivatedRoute,
        useValue: {
          snapshot: { queryParamMap: convertToParamMap(options.query ?? {}) },
        },
      },
    ],
  });
  await TestBed.inject(I18n).enter('public');
  const fixture = TestBed.createComponent(RequestQuoteButton);
  fixture.componentRef.setInput('garage', options.garage ?? GARAGE);
  fixture.detectChanges();
  await fixture.whenStable();
  return fixture.nativeElement as HTMLElement;
}

const button = (host: HTMLElement) =>
  host.querySelector('button') as HTMLButtonElement | null;

async function press(host: HTMLElement) {
  button(host)?.click();
  for (let i = 0; i < 4; i++) {
    await new Promise((resolve) => setTimeout(resolve));
    TestBed.tick();
  }
}

afterEach(() => TestBed.resetTestingModule());

// @traces 221-FR-002, 221-FR-013, 221-FR-016
describe('RequestQuoteButton', () => {
  it('is a primary Cere ofertă that opens the dialog for the garage, from the profile', async () => {
    const host = await render();

    expect(button(host)?.textContent?.trim()).toBe('Cere ofertă');
    expect(button(host)?.disabled).toBe(false);
    await press(host);

    expect(open).toHaveBeenCalledTimes(1);
    const [, options] = open.mock.calls[0];
    expect(options).toMatchObject({
      data: { garage: GARAGE, source: 'profile_direct' },
      shape: 'dialog',
      title: 'public.requestQuote.title',
    });
  });

  it('names the garage shared_link when the address carries src=share', async () => {
    const host = await render({ query: { src: 'share' } });

    await press(host);

    expect(open.mock.calls[0][1].data.source).toBe('shared_link');
  });

  it('is disabled with the red lamp’s text when the garage does not take the brand', async () => {
    const host = await render({
      garage: {
        ...GARAGE,
        brand: {
          ...(GARAGE.brand as NonNullable<PublicGarageDto['brand']>),
          stance: 'does_not_take',
        },
      },
    });

    expect(button(host)?.disabled).toBe(true);
    expect(host.textContent).toContain('Nu lucrează pe Dacia');
  });

  it('shows to a visitor and a driver, never in a garage role', async () => {
    expect(button(await render({ role: null }))).not.toBeNull();
    TestBed.resetTestingModule();
    expect(button(await render({ role: 'driver' }))).not.toBeNull();
    TestBed.resetTestingModule();
    expect(button(await render({ role: 'garage' }))).toBeNull();
    TestBed.resetTestingModule();
    expect(button(await render({ role: 'mechanic' }))).toBeNull();
  });

  it('says where the request went once it is sent, with the link to Cererile mele', async () => {
    const host = await render({ answer: request(['Service Auto Militari']) });

    await press(host);

    const status = host.querySelector('[role="status"]');
    expect(status?.textContent?.trim()).toBe(
      'Trimis către Service Auto Militari.',
    );
    expect(
      host.querySelector('a[href="/app/driver/requests"]')?.textContent?.trim(),
    ).toBe('Vezi Cererile mele');
    expect(button(host)).not.toBeNull();
  });

  it('counts the garages when it went to several', async () => {
    const host = await render({
      answer: request([
        'Service Auto Militari',
        'Atelier Berceni',
        'Auto Pipera',
      ]),
    });

    await press(host);

    expect(host.querySelector('[role="status"]')?.textContent?.trim()).toBe(
      'Trimis către 3 service‑uri.',
    );
  });

  it('shows nothing new when the dialog is closed without sending', async () => {
    const host = await render();

    await press(host);

    expect(host.querySelector('[role="status"]')).toBeNull();
  });
});
