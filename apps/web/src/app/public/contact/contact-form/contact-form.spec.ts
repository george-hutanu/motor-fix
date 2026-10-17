import { HttpErrorResponse } from '@angular/common/http';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { SupportService } from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';

import { ContactForm } from './contact-form';

// @traces 280-FR-005 280-FR-006 280-FR-007 280-FR-008 280-FR-009 280-FR-012 280-FR-022

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
const labelOf = (field: HTMLElement) =>
  root().querySelector(`label[for="${field.id}"]`)?.textContent?.trim();

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

describe('the contact form', () => {
  it('labels every field, gives name and e-mail their autocomplete, and shows the rule and a live count', async () => {
    await open();

    expect(labelOf(control('name'))).toBe('Numele tău');
    expect(labelOf(control('email'))).toBe('Adresa de e‑mail');
    expect(labelOf(control('topic'))).toBe('Despre ce este vorba?');
    expect(labelOf(control('message'))).toBe('Mesajul tău');
    expect(control('name').getAttribute('autocomplete')).toBe('name');
    expect(control('email').getAttribute('autocomplete')).toBe('email');
    expect(control('email').getAttribute('type')).toBe('email');
    expect(control('message').tagName).toBe('TEXTAREA');
    const options = [
      ...control<HTMLSelectElement>('topic').querySelectorAll('option'),
    ]
      .filter((o) => o.value)
      .map((o) => [o.value, o.textContent?.trim()]);
    expect(options).toEqual([
      ['request_or_booking', 'Cerere sau programare'],
      ['account', 'Contul meu'],
      ['reviews', 'Recenzii'],
      ['listing', 'Listarea service‑ului'],
      ['other', 'Altceva'],
    ]);
    const described = (
      control('message').getAttribute('aria-describedby') ?? ''
    )
      .split(' ')
      .map((id) => document.getElementById(id)?.textContent ?? '')
      .join(' ');
    expect(described).toContain('20');
    expect(described).toContain('2000');
    expect(text()).toContain('0 / 2000');
    type('message', 'Bună ziua');
    await settle();
    expect(text()).toContain('9 / 2000');
    expect(button('Trimite mesajul')?.type).toBe('submit');
  });

  it('speaks English', async () => {
    await open({ language: 'en' });

    expect(labelOf(control('name'))).toBe('Your name');
    expect(labelOf(control('email'))).toBe('E‑mail address');
    const labels = [
      ...control<HTMLSelectElement>('topic').querySelectorAll('option'),
    ]
      .filter((o) => o.value)
      .map((o) => o.textContent?.trim());
    expect(labels).toEqual([
      'Request or booking',
      'My account',
      'Reviews',
      'Listing my garage',
      'Something else',
    ]);
    expect(button('Send the message')).toBeDefined();
  });

  it('sends nothing for an empty form, shows each field’s error and focuses the first', async () => {
    await open();

    button('Trimite mesajul')?.click();
    await settle();

    expect(send).not.toHaveBeenCalled();
    for (const name of ['name', 'email', 'topic', 'message']) {
      expect(control(name).getAttribute('aria-invalid')).toBe('true');
    }
    expect(text()).toContain('Câmpul este obligatoriu.');
    expect(document.activeElement).toBe(control('name'));
  });

  it('refuses a message under 20 characters, a name of spaces and a bad address', async () => {
    await open();
    fill();
    type('name', '   ');
    type('email', 'ana@');
    type('message', '  prea scurt         ');

    button('Trimite mesajul')?.click();
    await settle();

    expect(send).not.toHaveBeenCalled();
    expect(text()).toContain('Scrie cel puțin 20 caractere.');
    expect(text()).toContain('Scrie o adresă de e‑mail validă.');
    expect(control('name').getAttribute('aria-invalid')).toBe('true');
    expect(document.activeElement).toBe(control('name'));
  });

  it('refuses a message over 2000 characters and a name over 80', async () => {
    await open();
    fill();
    type('name', 'a'.repeat(81));
    type('message', 'a'.repeat(2001));

    button('Trimite mesajul')?.click();
    await settle();

    expect(send).not.toHaveBeenCalled();
    expect(text()).toContain('Scrie cel mult 80 caractere.');
    expect(text()).toContain('Scrie cel mult 2000 caractere.');
  });

  it('sends once while busy, then shows the confirmation with the reference in a live region', async () => {
    await open();
    let answer!: (value: unknown) => void;
    send.mockReturnValueOnce(new Promise((resolve) => (answer = resolve)));
    fill();

    button('Trimite mesajul')?.click();
    await settle();
    // While busy, the button also holds the shared "sending" text.
    const submit = root().querySelector<HTMLButtonElement>(
      'button[type="submit"]',
    );
    expect(submit?.getAttribute('aria-busy')).toBe('true');
    expect(submit?.getAttribute('aria-disabled')).toBe('true');
    submit?.click();
    await settle();
    answer({ reference: 'MF-2026-000042' });
    await settle();

    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith({
      body: {
        email: EMAIL,
        language: 'ro',
        message: MESSAGE,
        name: NAME,
        topic: 'account',
      },
    });
    expect(root().querySelector('form')).toBeNull();
    const status = root().querySelector('[role="status"]');
    expect(status?.textContent).toContain(
      'Am primit mesajul tău. Îți răspundem pe e‑mail.',
    );
    expect(status?.textContent).toContain('MF-2026-000042');
  });

  it('sends the language of the page', async () => {
    await open({ language: 'en' });
    fill();

    button('Send the message')?.click();
    await settle();

    expect(send.mock.calls[0][0].body.language).toBe('en');
    expect(text()).toContain('We have your message. We will answer by e‑mail.');
  });

  it('says there were too many messages and keeps the text, with no retry', async () => {
    await open();

    await sendWith(
      new HttpErrorResponse({
        error: { code: 'too_many_messages', retryAfterSeconds: 3000 },
        status: 429,
      }),
    );

    expect(text()).toContain(
      'Prea multe mesaje. Încearcă din nou peste o oră.',
    );
    expect(control<HTMLTextAreaElement>('message').value).toBe(MESSAGE);
    expect(button('Încearcă din nou')).toBeUndefined();
  });

  it('says the message was not sent while offline, and offers to try again', async () => {
    await open();
    jest.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);

    await sendWith(new HttpErrorResponse({ status: 0 }));

    expect(text()).toContain('Nu ești conectat. Mesajul nu a fost trimis.');
    expect(control<HTMLTextAreaElement>('message').value).toBe(MESSAGE);
    expect(button('Încearcă din nou')).toBeDefined();
  });

  it('shows the shared maintenance message on a 503', async () => {
    await open();

    await sendWith(
      new HttpErrorResponse({ error: { code: 'maintenance' }, status: 503 }),
    );

    expect(text()).toContain('MotorFix este în mentenanță.');
    expect(control<HTMLTextAreaElement>('message').value).toBe(MESSAGE);
  });

  it('offers to try again after a server error, and the retry sends', async () => {
    await open();

    await sendWith(
      new HttpErrorResponse({ error: { code: 'internal_error' }, status: 500 }),
    );
    expect(text()).toContain('Ceva nu a mers la noi.');
    send.mockResolvedValueOnce({ reference: 'MF-2026-000043' });
    button('Încearcă din nou')?.click();
    await settle();

    expect(root().querySelector('[role="status"]')?.textContent).toContain(
      'MF-2026-000043',
    );
  });

  it('marks the field the server refused', async () => {
    await open();

    await sendWith(
      new HttpErrorResponse({
        error: {
          code: 'validation_failed',
          errors: [{ code: 'email', field: 'email' }],
        },
        status: 400,
      }),
    );

    expect(control('email').getAttribute('aria-invalid')).toBe('true');
    expect(button('Încearcă din nou')).toBeUndefined();
  });

  it('hides the trap from people, keyboards and screen readers, and sends it only when filled', async () => {
    await open();

    const trap = control<HTMLInputElement>('website');
    expect(trap.getAttribute('tabindex')).toBe('-1');
    expect(trap.getAttribute('autocomplete')).toBe('off');
    expect(trap.closest('[aria-hidden="true"]')).not.toBeNull();
    fill();
    type('website', 'https://spam.test');
    button('Trimite mesajul')?.click();
    await settle();

    expect(send.mock.calls[0][0].body.website).toBe('https://spam.test');
  });

  it('fills name and e-mail from the account, editable', async () => {
    await open({ prefill: { email: EMAIL, name: NAME } });

    expect(control<HTMLInputElement>('name').value).toBe(NAME);
    expect(control<HTMLInputElement>('email').value).toBe(EMAIL);
    expect(control('name').hasAttribute('readonly')).toBe(false);
    type('name', 'Ana Maria Pop');
    choose('other');
    type('message', MESSAGE);
    button('Trimite mesajul')?.click();
    await settle();

    expect(send.mock.calls[0][0].body).toMatchObject({
      email: EMAIL,
      name: 'Ana Maria Pop',
    });
  });

  it('leaves the e-mail empty for an account without one', async () => {
    await open({ prefill: { email: null, name: NAME } });

    expect(control<HTMLInputElement>('email').value).toBe('');
  });

  it('in a task, offers Close after the confirmation', async () => {
    await open({ inTask: true });
    const closed = jest.fn();
    fixture.componentInstance.closed.subscribe(closed);
    fill();

    button('Trimite mesajul')?.click();
    await settle();
    button('Închide')?.click();

    expect(closed).toHaveBeenCalledTimes(1);
    expect(document.activeElement?.textContent?.trim()).toBe('Închide');
  });

  it('names the Close after the confirmation apart from the overlay X', async () => {
    await open({ inTask: true });
    fill();

    button('Trimite mesajul')?.click();
    await settle();

    expect(button('Închide')?.getAttribute('aria-label')).toBe(
      'Închide formularul',
    );
  });

  it('names the Close in English apart from the overlay X', async () => {
    await open({ inTask: true, language: 'en' });
    fill();

    button('Send the message')?.click();
    await settle();

    expect(button('Close')?.getAttribute('aria-label')).toBe('Close the form');
  });

  it('on the page, offers no Close', async () => {
    await open();
    fill();

    button('Trimite mesajul')?.click();
    await settle();

    expect(button('Închide')).toBeUndefined();
  });
});

// @traces 248-launch-screens-accessible-FR-008
describe('the contact form’s errors tied to their fields', () => {
  it('points each field at the error it shows and marks it invalid', async () => {
    await open();

    button('Trimite mesajul')?.click();
    await settle();

    for (const name of ['name', 'email', 'topic', 'message']) {
      const said = (control(name).getAttribute('aria-describedby') ?? '')
        .split(' ')
        .map((id) => document.getElementById(id)?.textContent ?? '')
        .join(' ');
      expect(said).toContain('Câmpul este obligatoriu.');
      expect(control(name).getAttribute('aria-invalid')).toBe('true');
    }
  });

  it('keeps its status region in a polite live region', async () => {
    await open();

    const status = root().querySelector('.status');
    expect(status?.getAttribute('role')).toBe('status');
  });
});
