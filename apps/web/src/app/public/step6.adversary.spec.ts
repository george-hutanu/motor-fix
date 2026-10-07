import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { I18n } from '@motor-fix/i18n';
import { REDUCED_MOTION } from '@motor-fix/ui-cockpit';

import { ListYourGarage } from './list-your-garage';
import { completedCount, cuiError, rarError, readStep6 } from './step6';

describe('reading the verification step from hostile draft data', () => {
  it.each([
    ['null', null],
    ['undefined', undefined],
    ['a string', 'steps'],
    ['an array', []],
    ['steps as null', { steps: null }],
    ['steps as an array', { steps: [] }],
    ['the section as null', { steps: { '6': null } }],
    ['the section as an array', { steps: { '6': ['x'] } }],
    ['the section as a string', { steps: { '6': 'cui' } }],
  ])('reads empty fields from %s', (_, data) => {
    expect(readStep6(data)).toEqual({ cui: '', rarNumber: '' });
  });

  it('reads one field when the other is not text', () => {
    expect(
      readStep6({ steps: { '6': { cui: '18547290', rarNumber: 5 } } }),
    ).toEqual({
      cui: '18547290',
      rarNumber: '',
    });
    expect(
      readStep6({ steps: { '6': { cui: {}, rarNumber: 'ABC' } } }),
    ).toEqual({
      cui: '',
      rarNumber: 'ABC',
    });
  });

  it('ignores keys it does not own', () => {
    expect(
      readStep6({
        steps: { '5': { cui: '9' }, '6': { caen: '4520', cui: '1' } },
      }),
    ).toEqual({ cui: '1', rarNumber: '' });
  });

  it('does not mutate what it reads', () => {
    const data = { steps: { '6': { cui: '18547290', rarNumber: 'ABC' } } };
    const copy = JSON.parse(JSON.stringify(data));
    readStep6(data);
    expect(data).toEqual(copy);
  });
});

describe('the field errors at their edges', () => {
  it.each([
    ['one digit', '1'],
    ['eleven digits', '12345678901'],
    ['a letter among the digits', '1854729A'],
    ['a prefix left in', 'RO18547290'],
  ])('flags %s once left', (_, value) => {
    expect(cuiError(value, true)).toBe('cuiInvalid');
    expect(cuiError(value, false)).toBeNull();
  });

  it('keeps the error following the value once left', () => {
    expect(cuiError('18547291', true)).toBe('cuiInvalid');
    expect(cuiError('18547290', true)).toBeNull();
    expect(cuiError('18547291', true)).toBe('cuiInvalid');
  });

  it('asks for three characters at two and not at three', () => {
    expect(rarError('AB', true)).toBe('rarShort');
    expect(rarError('ABC', true)).toBeNull();
  });

  it('stays quiet for a forty-character RAR number', () => {
    expect(rarError('A'.repeat(40), true)).toBeNull();
  });

  it('stays quiet for an empty RAR number whether left or not', () => {
    expect(rarError('', true)).toBeNull();
    expect(rarError('', false)).toBeNull();
  });
});

describe('the step counter at its edges', () => {
  it('counts by true values, not by position', () => {
    expect(completedCount([false, false, false, false, true])).toBe(1);
    expect(completedCount([false, false, true, false, false])).toBe(1);
  });
});

async function open(path: string) {
  localStorage.clear();
  TestBed.configureTestingModule({
    providers: [
      provideRouter([
        { component: ListYourGarage, path: ':lang/list-your-garage' },
      ]),
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: REDUCED_MOTION, useValue: signal(false) },
    ],
  });
  const i18n = TestBed.inject(I18n);
  await i18n.enter('public');
  if (path.startsWith('/en/')) await i18n.use('en');
  const harness = await RouterTestingHarness.create();
  await harness.navigateByUrl(path);
  await settle(harness);
  return { harness, i18n, page: harness.routeNativeElement as HTMLElement };
}

async function settle(harness: RouterTestingHarness) {
  for (let i = 0; i < 2; i++) {
    harness.detectChanges();
    await harness.fixture.whenStable();
  }
}

const text = (element: Element | null | undefined) =>
  (element?.textContent ?? '').replace(/‑/g, '-').replace(/\s+/g, ' ').trim();

async function type(
  harness: RouterTestingHarness,
  input: HTMLInputElement,
  value: string,
) {
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await settle(harness);
}

async function leave(harness: RouterTestingHarness, input: HTMLInputElement) {
  input.dispatchEvent(new Event('blur'));
  await settle(harness);
}

const cui = (page: HTMLElement) =>
  page.querySelector<HTMLInputElement>('#listing-cui') as HTMLInputElement;
const rar = (page: HTMLElement) =>
  page.querySelector<HTMLInputElement>('#listing-rar') as HTMLInputElement;
const cuiErr = (page: HTMLElement) =>
  text(page.querySelector('#listing-cui-error'));
const rarErr = (page: HTMLElement) =>
  text(page.querySelector('#listing-rar-error'));
const counter = (page: HTMLElement) =>
  text(
    [...page.querySelectorAll('p.note[role="status"]')].find((p) =>
      /\d+ (din|of) 5/.test(text(p)),
    ),
  );

describe('step 6 of the page under hostile typing', () => {
  afterEach(() => {
    localStorage.clear();
  });

  it('shows the error, the invalid flag and the description after leaving a wrong CUI', async () => {
    const { harness, page } = await open('/ro/list-your-garage');
    await type(harness, cui(page), 'RO 18547291');
    await leave(harness, cui(page));
    expect(cuiErr(page)).toBe('CUI invalid');
    expect(cui(page).getAttribute('aria-invalid')).toBe('true');
    expect(cui(page).getAttribute('aria-describedby')).toBe(
      'listing-cui-error',
    );
    expect(cui(page).value).toBe('18547291');
  });

  it('clears the error as soon as the value turns valid, without leaving again', async () => {
    const { harness, page } = await open('/ro/list-your-garage');
    await type(harness, cui(page), '18547291');
    await leave(harness, cui(page));
    await type(harness, cui(page), 'RO18547290');
    expect(cuiErr(page)).toBe('');
    expect(counter(page)).toBe('1 din 5 completate');
  });

  it('brings the error back when a left field turns wrong again', async () => {
    const { harness, page } = await open('/ro/list-your-garage');
    await type(harness, cui(page), '18547290');
    await leave(harness, cui(page));
    await type(harness, cui(page), '18547299');
    expect(cuiErr(page)).toBe('CUI invalid');
  });

  it('treats a prefix alone as an empty field with no error', async () => {
    const { harness, page } = await open('/ro/list-your-garage');
    await type(harness, cui(page), 'RO');
    await leave(harness, cui(page));
    expect(cuiErr(page)).toBe('');
    expect(cui(page).value).toBe('');
    expect(counter(page)).toBe('0 din 5 completate');
  });

  it('removes the error when the left field is cleared', async () => {
    const { harness, page } = await open('/ro/list-your-garage');
    await type(harness, cui(page), '1');
    await leave(harness, cui(page));
    expect(cuiErr(page)).toBe('CUI invalid');
    await type(harness, cui(page), '');
    await leave(harness, cui(page));
    expect(cuiErr(page)).toBe('');
  });

  it('describes the RAR field by its hint until an error shows', async () => {
    const { harness, page } = await open('/ro/list-your-garage');
    expect(rar(page).getAttribute('aria-describedby')).toBe('listing-rar-hint');
    await type(harness, rar(page), 'ab');
    await leave(harness, rar(page));
    expect(rarErr(page)).toBe('Cel puțin 3 caractere');
    expect(rar(page).getAttribute('aria-invalid')).toBe('true');
    expect(rar(page).getAttribute('aria-describedby')).toBe(
      'listing-rar-error',
    );
    await type(harness, rar(page), 'abc');
    expect(rarErr(page)).toBe('');
    expect(rar(page).getAttribute('aria-describedby')).toBe('listing-rar-hint');
  });

  it('does not count a RAR number of spaces and one letter', async () => {
    const { harness, page } = await open('/ro/list-your-garage');
    await type(harness, rar(page), '  a  ');
    await leave(harness, rar(page));
    expect(counter(page)).toBe('0 din 5 completate');
    expect(rarErr(page)).toBe('Cel puțin 3 caractere');
  });

  it('cuts a pasted RAR number at forty characters', async () => {
    const { harness, page } = await open('/ro/list-your-garage');
    await type(harness, rar(page), 'x'.repeat(60));
    await leave(harness, rar(page));
    expect(rar(page).value).toBe('X'.repeat(40));
  });

  it('caps both inputs at forty characters', async () => {
    const { page } = await open('/ro/list-your-garage');
    expect(cui(page).getAttribute('maxlength')).toBe('40');
    expect(rar(page).getAttribute('maxlength')).toBe('40');
    expect(cui(page).getAttribute('inputmode')).toBe('numeric');
  });

  it('moves the counter to 2 and back as values come and go', async () => {
    const { harness, page } = await open('/ro/list-your-garage');
    expect(counter(page)).toBe('0 din 5 completate');
    await type(harness, cui(page), '18547290');
    await type(harness, rar(page), 'abc');
    expect(counter(page)).toBe('2 din 5 completate');
    await type(harness, cui(page), '');
    expect(counter(page)).toBe('1 din 5 completate');
  });
});
