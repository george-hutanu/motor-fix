import { HttpErrorResponse } from '@angular/common/http';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { SupportService } from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';

import { ContactForm } from './contact-form';

// @traces 280-FR-005 280-FR-007 280-FR-008 280-FR-009 280-FR-012

const NAME = 'Ana Pop';
const EMAIL = 'ana@example.test';
const MESSAGE = 'Nu văd cererea pe care am trimis‑o ieri.';

let send: jest.Mock;
let fixture: ComponentFixture<ContactForm>;

async function settle() {
  for (let i = 0; i < 6; i++) {
    TestBed.tick();
    await new Promise((resolve) => setTimeout(resolve));
  }
}

async function open(
  options: {
    language?: 'ro' | 'en';
    prefill?: { name: string; email: string | null };
    inTask?: boolean;
  } = {},
) {
  send = jest.fn(async () => ({ reference: 'MF-2026-000042' }));
  TestBed.configureTestingModule({
    providers: [
      {
        provide: SupportService,
        useValue: { supportMessagesControllerCreate: send },
      },
    ],
  });
  if (options.language === 'en') await TestBed.inject(I18n).use('en');
  fixture = TestBed.createComponent(ContactForm);
  if (options.prefill)
    fixture.componentRef.setInput('prefill', options.prefill);
  if (options.inTask) fixture.componentRef.setInput('inTask', true);
  document.body.appendChild(fixture.nativeElement);
  await settle();
}

afterEach(() => {
  fixture?.nativeElement.remove();
  jest.restoreAllMocks();
});

const root = () => fixture.nativeElement as HTMLElement;
const control = <T extends HTMLElement>(name: string) =>
  root().querySelector<T>(`[formcontrolname="${name}"]`) as T;
const button = (name: string) =>
  [...root().querySelectorAll('button')].find(
    (b) => b.textContent?.trim() === name,
  ) as HTMLButtonElement | undefined;
const text = () => (root().textContent ?? '').replace(/\s+/g, ' ');

function type(name: string, value: string) {
  const field = control<HTMLInputElement>(name);
  field.value = value;
  field.dispatchEvent(new Event('input', { bubbles: true }));
}

function choose(value: string) {
  const select = control<HTMLSelectElement>('topic');
  select.value = value;
  select.dispatchEvent(new Event('change', { bubbles: true }));
}

function fill() {
  type('name', NAME);
  type('email', EMAIL);
  choose('account');
  type('message', MESSAGE);
}

async function sendWith(error: HttpErrorResponse) {
  send.mockRejectedValueOnce(error);
  fill();
  button('Trimite mesajul')?.click();
  await settle();
}

describe('the contact form under hostile use', () => {
  it('sends a name of exactly 80 characters and a message of exactly 20 and exactly 2000', async () => {
    await open();
    fill();
    type('name', 'a'.repeat(80));
    type('message', 'b'.repeat(20));
    button('Trimite mesajul')?.click();
    await settle();
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0].body).toMatchObject({
      message: 'b'.repeat(20),
      name: 'a'.repeat(80),
    });
  });

  it('accepts a message of exactly 2000 characters', async () => {
    await open();
    fill();
    type('message', 'b'.repeat(2000));
    button('Trimite mesajul')?.click();
    await settle();
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('refuses 19 characters', async () => {
    await open();
    fill();
    type('message', 'b'.repeat(19));
    button('Trimite mesajul')?.click();
    await settle();
    expect(send).not.toHaveBeenCalled();
    expect(control('message').getAttribute('aria-invalid')).toBe('true');
  });

  it('counts characters after trimming, so padding does not reach 20', async () => {
    await open();
    fill();
    type('message', `${' '.repeat(30)}abc${'\n'.repeat(30)}`);
    button('Trimite mesajul')?.click();
    await settle();
    expect(send).not.toHaveBeenCalled();
    expect(text()).toContain('Scrie cel puțin 20 caractere.');
  });

  it('counts 20 emoji as 20 characters', async () => {
    await open();
    fill();
    type('message', '😀'.repeat(20));
    button('Trimite mesajul')?.click();
    await settle();
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('refuses an address of 255 characters', async () => {
    await open();
    fill();
    type('email', `${'a'.repeat(255 - '@example.test'.length)}@example.test`);
    button('Trimite mesajul')?.click();
    await settle();
    expect(send).not.toHaveBeenCalled();
    expect(control('email').getAttribute('aria-invalid')).toBe('true');
  });

  it('sends once when the form is submitted twice by Enter before the answer', async () => {
    await open();
    let answer!: (value: unknown) => void;
    send.mockReturnValueOnce(new Promise((resolve) => (answer = resolve)));
    fill();
    const form = root().querySelector('form') as HTMLFormElement;
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    await settle();
    answer({ reference: 'MF-2026-000042' });
    await settle();
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('does not send the trap when it is empty', async () => {
    await open();
    fill();
    button('Trimite mesajul')?.click();
    await settle();
    expect(send.mock.calls[0][0].body).not.toHaveProperty('website');
  });

  it('does not show the confirmation twice, nor send again, after the success', async () => {
    await open();
    fill();
    button('Trimite mesajul')?.click();
    await settle();
    root().querySelector('form')?.dispatchEvent(new Event('submit'));
    await settle();
    expect(send).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['name', 'Ana Pop'],
    ['email', 'ana@example.test'],
  ])('keeps the %s after a 429', async (field, value) => {
    await open();
    await sendWith(
      new HttpErrorResponse({
        error: { code: 'too_many_messages' },
        status: 429,
      }),
    );
    expect(control<HTMLInputElement>(field).value).toBe(value);
    expect(control<HTMLSelectElement>('topic').value).toBe('account');
  });

  it('says too many messages in English on a 429', async () => {
    await open({ language: 'en' });
    send.mockRejectedValueOnce(
      new HttpErrorResponse({
        error: { code: 'too_many_messages' },
        status: 429,
      }),
    );
    fill();
    button('Send the message')?.click();
    await settle();
    expect(text()).toContain('Too many messages. Try again in an hour.');
  });

  it('says offline in English', async () => {
    await open({ language: 'en' });
    jest.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    send.mockRejectedValueOnce(new HttpErrorResponse({ status: 0 }));
    fill();
    button('Send the message')?.click();
    await settle();
    expect(text()).toContain('You are offline. The message was not sent.');
  });

  it('does not say offline when the browser is online and nothing answered', async () => {
    await open();
    jest.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
    await sendWith(new HttpErrorResponse({ status: 0 }));
    expect(text()).not.toContain('Nu ești conectat.');
    expect(button('Încearcă din nou')).toBeDefined();
    expect(control<HTMLTextAreaElement>('message').value).toBe(MESSAGE);
  });

  it.each([500, 502, 504, 404, 401])(
    'offers to try again after a %d and keeps the text',
    async (status) => {
      await open();
      await sendWith(new HttpErrorResponse({ status }));
      expect(button('Încearcă din nou')).toBeDefined();
      expect(control<HTMLTextAreaElement>('message').value).toBe(MESSAGE);
      expect(text()).not.toContain('MF-');
    },
  );

  it('survives a 400 with no field list and keeps the text', async () => {
    await open();
    await sendWith(
      new HttpErrorResponse({
        error: { code: 'validation_failed' },
        status: 400,
      }),
    );
    expect(control<HTMLTextAreaElement>('message').value).toBe(MESSAGE);
    expect(root().querySelector('form')).not.toBeNull();
  });

  it('survives a 400 naming a field the form does not have', async () => {
    await open();
    await sendWith(
      new HttpErrorResponse({
        error: {
          code: 'validation_failed',
          errors: [{ code: 'x', field: 'role' }],
        },
        status: 400,
      }),
    );
    expect(root().querySelector('form')).not.toBeNull();
  });

  it('sends the same text again on a retry after a failure, once', async () => {
    await open();
    await sendWith(new HttpErrorResponse({ status: 500 }));
    button('Încearcă din nou')?.click();
    await settle();
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[1][0]).toEqual(send.mock.calls[0][0]);
  });

  it('shows no reference when the answer holds none', async () => {
    await open();
    send.mockResolvedValueOnce({});
    fill();
    button('Trimite mesajul')?.click();
    await settle();
    expect(text()).not.toContain('undefined');
  });

  it('shows a prefilled name that is over 80 characters as an error and sends nothing', async () => {
    await open({ prefill: { email: EMAIL, name: 'a'.repeat(81) } });
    choose('account');
    type('message', MESSAGE);
    button('Trimite mesajul')?.click();
    await settle();
    expect(send).not.toHaveBeenCalled();
    expect(control('name').getAttribute('aria-invalid')).toBe('true');
  });
});
