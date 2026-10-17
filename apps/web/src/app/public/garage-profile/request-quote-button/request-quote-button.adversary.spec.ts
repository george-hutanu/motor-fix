import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  ActivatedRoute,
  convertToParamMap,
  provideRouter,
} from '@angular/router';
import type { PublicGarageDto } from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';
import { Overlays } from '@motor-fix/overlays';

import { RequestQuoteButton } from './request-quote-button';
import { Consent } from '../../../consent/consent';
import { Session } from '../../../dashboard/session';

const GARAGE: PublicGarageDto = {
  brand: { id: 'b-1', name: 'Dacia', slug: 'dacia', stance: 'works_on' },
  brandNote: null,
  doesNotTake: [],
  id: 'g-militari',
  jobTypes: [],
  name: 'Service Auto Militari',
  paymentMethods: { card: false, cash: false, transfer: false },
  photos: [],
  prices: [],
  rating: null,
  refusalPhrase: null,
  responseRate: { state: 'new' },
  reviewCount: 0,
  slug: 'service-auto-militari',
  verifiedAt: null,
  worksOn: [],
};

let open: jest.Mock;
let track: jest.Mock;

async function render(
  options: {
    garage?: PublicGarageDto;
    role?: 'driver' | 'garage' | null;
    jobs?: readonly string[] | undefined | null;
    textKey?: string;
  } = {},
) {
  open = jest.fn(async () => 'cancelled');
  track = jest.fn();
  const role = options.role ?? null;
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      { provide: Overlays, useValue: { open } },
      { provide: Consent, useValue: { track } },
      {
        provide: Session,
        useValue: {
          current: signal(role ? { role } : null),
          load: jest.fn(async () => null),
          renew: jest.fn(async () => true),
          roleHint: signal(null),
        },
      },
      {
        provide: ActivatedRoute,
        useValue: { snapshot: { queryParamMap: convertToParamMap({}) } },
      },
    ],
  });
  await TestBed.inject(I18n).enter('public');
  const fixture = TestBed.createComponent(RequestQuoteButton);
  fixture.componentRef.setInput('garage', options.garage ?? GARAGE);
  if ('jobs' in options) fixture.componentRef.setInput('jobs', options.jobs);
  if (options.textKey)
    fixture.componentRef.setInput('textKey', options.textKey);
  fixture.detectChanges();
  await fixture.whenStable();
  return fixture;
}

const button = (f: { nativeElement: HTMLElement }) =>
  f.nativeElement.querySelector('button') as HTMLButtonElement | null;

async function press(f: { nativeElement: HTMLElement }) {
  button(f)?.click();
  for (let i = 0; i < 4; i++) {
    await new Promise((resolve) => setTimeout(resolve));
    TestBed.tick();
  }
}

afterEach(() => TestBed.resetTestingModule());

// @traces 356-live-estimate-FR-011
describe('RequestQuoteButton handing jobs over, hostile', () => {
  it('passes no jobs when the input is bound to undefined', async () => {
    const f = await render({ jobs: undefined });
    await press(f);

    expect('jobTypeIds' in open.mock.calls[0][1].data).toBe(false);
  });

  it('hands over a copy, so a later change to the list does not reach the dialog', async () => {
    const jobs = ['j-diag'];
    const f = await render({ jobs });
    await press(f);

    jobs.push('j-late');

    expect(open.mock.calls[0][1].data.jobTypeIds).toEqual(['j-diag']);
    expect(open.mock.calls[0][1].data.jobTypeIds).not.toBe(jobs);
  });

  it('hands over the new jobs on the next press after the input changed', async () => {
    const f = await render({ jobs: ['j-diag'] });
    await press(f);
    f.componentRef.setInput('jobs', ['j-brakes', 'j-chain']);
    f.detectChanges();

    await press(f);

    expect(open.mock.calls[1][1].data.jobTypeIds).toEqual([
      'j-brakes',
      'j-chain',
    ]);
  });

  it('hands over the list as it is, with no ids invented', async () => {
    const f = await render({ jobs: ['', 'j-diag', 'j-diag'] });
    await press(f);

    expect(open.mock.calls[0][1].data.jobTypeIds).toEqual([
      '',
      'j-diag',
      'j-diag',
    ]);
  });

  it('tells the event once per press with jobs handed over', async () => {
    const f = await render({ jobs: ['j-diag'] });

    await press(f);
    await press(f);

    expect(track).toHaveBeenCalledTimes(2);
    expect(track).toHaveBeenNthCalledWith(1, 'quote_request_started', {
      source: 'profile',
    });
  });

  it('opens nothing when the brand is refused, jobs or not', async () => {
    const f = await render({
      garage: {
        ...GARAGE,
        brand: {
          ...(GARAGE.brand as NonNullable<PublicGarageDto['brand']>),
          stance: 'does_not_take',
        },
      },
      jobs: ['j-diag'],
    });

    expect(button(f)?.disabled).toBe(true);
    await press(f);

    expect(open).not.toHaveBeenCalled();
    expect(track).not.toHaveBeenCalled();
  });

  it('is not shown in a garage role, with jobs bound too', async () => {
    const f = await render({ jobs: ['j-diag'], role: 'garage' });

    expect(button(f)).toBeNull();
  });

  it('writes the text the key names, in English too', async () => {
    const f = await render({
      jobs: [],
      textKey: 'public.garageProfile.estimate.request',
    });
    expect(button(f)?.textContent?.trim()).toBe('CERE OFERTĂ');

    await TestBed.inject(I18n).use('en');
    f.detectChanges();

    expect(button(f)?.textContent?.trim()).toBe('REQUEST A QUOTE');
  });
});
