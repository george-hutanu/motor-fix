import { HttpErrorResponse } from '@angular/common/http';
import { Component, inject } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { type MeDto, MeService } from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';
import { type OverlayResult, Overlays } from '@motor-fix/overlays';

import { PhoneChangeDialog } from './phone-change-dialog';

@Component({ template: '' })
class Host {
  readonly overlays = inject(Overlays);
}

const problem = (status: number, code: string) =>
  new HttpErrorResponse({ error: { code, status }, status });

const ME = { id: 'a1', phone: '+40722123456', phoneConfirmed: true } as MeDto;

let request: jest.Mock;
let confirm: jest.Mock;
let result: Promise<OverlayResult<MeDto>>;

async function settle() {
  for (let i = 0; i < 6; i++) {
    TestBed.tick();
    await new Promise((resolve) => setTimeout(resolve));
  }
}

async function open(language: 'ro' | 'en' = 'ro') {
  request = jest.fn(async () => undefined);
  confirm = jest.fn(async () => ME);
  TestBed.configureTestingModule({
    providers: [
      {
        provide: MeService,
        useValue: {
          phoneChangeControllerConfirm: confirm,
          phoneChangeControllerRequest: request,
        },
      },
    ],
  });
  if (language === 'en') await TestBed.inject(I18n).use('en');
  const host = TestBed.createComponent(Host);
  result = host.componentInstance.overlays.open<MeDto>(PhoneChangeDialog, {
    shape: 'dialog',
    title: 'driver.phoneChange.title',
  });
  await settle();
}

const panel = () =>
  document.querySelector<HTMLElement>('mf-overlay-panel') as HTMLElement;

function field(label: string): HTMLInputElement {
  const found = [...panel().querySelectorAll('label')].find(
    (l) => l.textContent?.trim() === label,
  );
  const input = found?.htmlFor ? document.getElementById(found.htmlFor) : null;
  if (!(input instanceof HTMLInputElement)) throw new Error(`no ${label}`);
  return input;
}

function type(input: HTMLInputElement, value: string) {
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

const button = (name: string) =>
  [...panel().querySelectorAll('button')].find(
    (b) => b.textContent?.trim() === name,
  ) as HTMLButtonElement | undefined;

const text = () => panel().textContent ?? '';

// To the code step, the code sent to 0722 123 456.
async function toCode() {
  type(field('Număr de telefon'), '0722 123 456');
  button('Trimite codul')?.click();
  await settle();
}

afterEach(() => {
  document.querySelectorAll('.cdk-overlay-container').forEach((n) => {
    n.innerHTML = '';
  });
});

// @traces 139-FR-011
// @traces 139-FR-013
// @traces 139-FR-018
describe('the phone dialog', () => {
  it('asks for the number in a phone field that starts with +40', async () => {
    await open();

    expect(panel().querySelector('h2')?.textContent?.trim()).toBe(
      'Schimbă numărul de telefon',
    );
    const input = field('Număr de telefon');
    expect(input.type).toBe('tel');
    expect(input.autocomplete).toBe('tel');
    expect(input.value).toBe('+40');
    expect(button('Trimite codul')?.type).toBe('submit');
  });

  it.each(['+400722123456', '+40 0722 123 456'])(
    'reads 07xx typed after the +40 already there (%s) as +407xx',
    async (typed) => {
      await open();

      type(field('Număr de telefon'), typed);
      button('Trimite codul')?.click();
      await settle();

      expect(request).toHaveBeenCalledWith({ body: { phone: '+40722123456' } });
    },
  );

  it('reads a number typed as 07xx as +40 and moves to the code step', async () => {
    await open();

    await toCode();

    expect(request).toHaveBeenCalledWith({ body: { phone: '+40722123456' } });
    expect(text()).toContain('+40722123456');
    const code = field('Cod');
    expect(code.inputMode).toBe('numeric');
    expect(code.autocomplete).toBe('one-time-code');
    expect(button('Confirmă')?.type).toBe('submit');
    expect(button('Trimite un cod nou')).toBeDefined();
  });

  it.each([
    ['nothing', ''],
    ['letters', 'telefonul meu'],
    ['too few digits', '0722'],
  ])('refuses %s before sending', async (_, value) => {
    await open();
    const input = field('Număr de telefon');
    type(input, value);

    button('Trimite codul')?.click();
    await settle();

    expect(request).not.toHaveBeenCalled();
    expect(input.getAttribute('aria-invalid')).toBe('true');
  });

  it('confirms the code and closes with who am I', async () => {
    await open();
    await toCode();
    type(field('Cod'), '123456');

    button('Confirmă')?.click();
    await settle();

    expect(confirm).toHaveBeenCalledWith({ body: { code: '123456' } });
    await expect(result).resolves.toEqual(ME);
  });

  it('refuses a code that is not six digits before sending', async () => {
    await open();
    await toCode();
    const code = field('Cod');
    type(code, '12a');

    button('Confirmă')?.click();
    await settle();

    expect(confirm).not.toHaveBeenCalled();
    expect(code.getAttribute('aria-invalid')).toBe('true');
  });

  it('sends a new code to the same number', async () => {
    await open();
    await toCode();

    button('Trimite un cod nou')?.click();
    await settle();

    expect(request).toHaveBeenCalledTimes(2);
    expect(request).toHaveBeenLastCalledWith({
      body: { phone: '+40722123456' },
    });
  });

  it.each([
    [409, 'phone_taken', 'Numărul e folosit de alt cont MotorFix.'],
    [409, 'phone_unchanged', 'Acesta e numărul tău actual.'],
    [503, 'send_failed', 'Nu am putut trimite. Încearcă din nou.'],
    [
      429,
      'too_many_attempts',
      'Prea multe încercări. Încearcă din nou mai târziu.',
    ],
  ])(
    'stays on the number and says why on %s %s',
    async (status, code, message) => {
      await open();
      request.mockRejectedValueOnce(problem(status, code));

      await toCode();

      expect(text()).toContain(message);
      expect(field('Număr de telefon').value).toBe('0722 123 456');
    },
  );

  it.each([
    [401, 'code_invalid', 'Codul nu e corect.'],
    [410, 'code_expired', 'Codul a expirat'],
    [409, 'phone_taken', 'Numărul e folosit de alt cont MotorFix.'],
    [
      429,
      'too_many_attempts',
      'Prea multe încercări. Încearcă din nou mai târziu.',
    ],
  ])(
    'stays on the code and says why on %s %s',
    async (status, code, message) => {
      await open();
      await toCode();
      confirm.mockRejectedValueOnce(problem(status, code));
      type(field('Cod'), '123456');

      button('Confirmă')?.click();
      await settle();

      expect(text()).toContain(message);
      expect(button('Trimite un cod nou')).toBeDefined();
    },
  );

  it('reads English', async () => {
    await open('en');

    expect(panel().querySelector('h2')?.textContent?.trim()).toBe(
      'Change the phone number',
    );
    type(field('Phone number'), '0722 123 456');
    button('Send the code')?.click();
    await settle();
    expect(field('Code')).toBeDefined();
    expect(button('Confirm')).toBeDefined();
    expect(button('Send a new code')).toBeDefined();
  });

  it('says why in English', async () => {
    await open('en');
    request.mockRejectedValueOnce(problem(409, 'phone_taken'));
    type(field('Phone number'), '0722 123 456');

    button('Send the code')?.click();
    await settle();

    expect(text()).toContain('The number is used by another MotorFix account.');
  });
});
