import { HttpErrorResponse } from '@angular/common/http';
import { RESPONSE_INIT } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Title } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { CarsService, type CarTransferLinkDto } from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';

import { TransferPage } from './transfer';
import { PUBLIC_READ } from '../../public-read';
import { publicChildren } from '../routes';

const refusal = (status: number, code?: string) =>
  new HttpErrorResponse({
    error: code ? { code, title: 'no' } : null,
    status,
  });

let read: jest.Mock;
let response: { status?: number };
let harness: RouterTestingHarness;

async function settle() {
  for (let i = 0; i < 4; i++) {
    await new Promise((resolve) => setTimeout(resolve));
    harness.detectChanges();
  }
}

async function open(
  answer: () => Promise<CarTransferLinkDto>,
  language: 'ro' | 'en' = 'ro',
  server = true,
) {
  read = jest.fn(answer);
  response = {};
  TestBed.configureTestingModule({
    providers: [
      provideRouter([
        { component: TransferPage, path: ':lang/transfer/:token' },
        { children: [], path: ':lang' },
      ]),
      {
        provide: CarsService,
        useValue: { carTransferLinkControllerRead: read },
      },
      ...(server ? [{ provide: RESPONSE_INIT, useValue: response }] : []),
    ],
  });
  await TestBed.inject(I18n).enter('public');
  if (language === 'en') await TestBed.inject(I18n).use('en');
  harness = await RouterTestingHarness.create();
  await harness.navigateByUrl(`/${language}/transfer/abc123`);
  await settle();
}

const page = () => harness.routeNativeElement as HTMLElement;
const said = () => (page().textContent ?? '').replace(/\s+/g, ' ').trim();
const heading = () => page().querySelector('h1')?.textContent?.trim();
const title = () => TestBed.inject(Title).getTitle();

// @traces 1392-FR-005 1392-FR-006 1392-FR-007 1392-SC-003
describe('the public transfer page', () => {
  it('reads the link as a visitor and says it is valid, served 200', async () => {
    await open(async () => ({ status: 'sent' }));

    expect(read).toHaveBeenCalledWith({ token: 'abc123' }, expect.anything());
    expect(read.mock.calls[0][1].get(PUBLIC_READ)).toBe(true);
    expect(heading()).toBe(
      'Linkul e valabil. Preluarea mașinii vine în curând.',
    );
    expect(title()).toBe('Linkul e valabil. Preluarea mașinii vine în curând.');
    expect(response.status).toBeUndefined();
  });

  it('never shows the seller, the car or the repair count the answer carries', async () => {
    await open(async () => ({
      car: { brand: 'BMW', model: '320d', year: 2019 },
      repairCount: 4,
      sellerName: 'Ion P.',
      status: 'sent',
    }));

    expect(said()).toContain('Linkul e valabil.');
    expect(said()).not.toContain('BMW');
    expect(said()).not.toContain('Ion P.');
    expect(said()).not.toContain('4');
  });

  it('shows the valid line to the seller opening their own link', async () => {
    await open(async () => {
      throw refusal(403, 'own_transfer');
    });

    expect(heading()).toBe(
      'Linkul e valabil. Preluarea mașinii vine în curând.',
    );
    expect(response.status).toBeUndefined();
  });

  it.each([
    [404, 'not_found', 'Linkul nu există'],
    [410, 'transfer_cancelled', 'Linkul nu mai e valabil'],
    [410, 'transfer_expired', 'Linkul a expirat'],
    [410, 'transfer_accepted', 'Mașina a fost deja preluată'],
  ])('serves %s %s as "%s"', async (status, code, text) => {
    await open(async () => {
      throw refusal(status, code);
    });

    expect(heading()).toBe(text);
    expect(title()).toBe(text);
    expect(response.status).toBe(status);
  });

  it.each([
    [404, 'not_found', 'This link does not exist'],
    [410, 'transfer_cancelled', 'The link is no longer valid'],
    [410, 'transfer_expired', 'The link has expired'],
    [410, 'transfer_accepted', 'The car has already been taken over'],
  ])('reads %s %s in English', async (status, code, text) => {
    await open(async () => {
      throw refusal(status, code);
    }, 'en');

    expect(heading()).toBe(text);
  });

  it('says the link is valid in English', async () => {
    await open(async () => ({ status: 'sent' }), 'en');

    expect(heading()).toBe(
      'This link is valid. Taking the car over is coming soon.',
    );
  });

  it('says the link could not be checked and reads again on the retry', async () => {
    let calls = 0;
    await open(async () => {
      calls += 1;
      if (calls === 1) throw refusal(500, 'error');
      return { status: 'sent' };
    });

    expect(said()).toContain('Nu am putut verifica linkul. Încearcă din nou.');
    expect(response.status).toBeUndefined();
    page().querySelector('button')?.click();
    await settle();

    expect(read).toHaveBeenCalledTimes(2);
    expect(heading()).toBe(
      'Linkul e valabil. Preluarea mașinii vine în curând.',
    );
  });

  it('shows the loading state until the read answers', async () => {
    let answer: (value: CarTransferLinkDto) => void = () => undefined;
    await open(
      () =>
        new Promise<CarTransferLinkDto>((resolve) => {
          answer = resolve;
        }),
      'ro',
      false,
    );

    expect(page().querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(said()).toContain('Verificăm linkul…');

    answer({ status: 'sent' });
    await settle();
    expect(page().querySelector('[aria-busy="true"]')).toBeNull();
  });

  it('is routed as a page search engines must not index', () => {
    expect(
      publicChildren.find((route) => route.path === 'transfer/:token')?.data,
    ).toEqual({ noindex: true });
  });

  it('offers no sign-in prompt and no action in its body', async () => {
    await open(async () => ({ status: 'sent' }));

    expect(page().querySelectorAll('button, a')).toHaveLength(0);
  });
});
