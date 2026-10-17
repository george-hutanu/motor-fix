import { Component, inject, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { type MeDto, SupportService } from '@motor-fix/data-access';
import { type OverlayResult, Overlays } from '@motor-fix/overlays';

import { openContact } from './open-contact';
import { Session } from '../session';

// @traces 280-FR-004 280-FR-006

@Component({ template: '<button type="button" id="entry">Ajutor</button>' })
class Host {
  readonly overlays = inject(Overlays);
}

const MESSAGE = 'Nu văd cererea pe care am trimis‑o ieri.';

let send: jest.Mock;
let result: Promise<OverlayResult<true>>;

async function settle() {
  for (let i = 0; i < 6; i++) {
    TestBed.tick();
    await new Promise((resolve) => setTimeout(resolve));
  }
}

async function open(email: string | null = 'ana@example.test') {
  send = jest.fn(async () => ({ reference: 'MF-2026-000042' }));
  const account = signal({
    email,
    name: 'Ana Pop',
    role: 'driver',
  } as unknown as MeDto);
  TestBed.configureTestingModule({
    providers: [
      {
        provide: SupportService,
        useValue: { supportMessagesControllerCreate: send },
      },
      { provide: Session, useValue: { current: account, shown: account } },
    ],
  });
  const host = TestBed.createComponent(Host);
  document.body.appendChild(host.nativeElement);
  const entry = host.nativeElement.querySelector('#entry') as HTMLElement;
  entry.focus();
  result = openContact(host.componentInstance.overlays);
  await settle();
  return entry;
}

const panel = () =>
  document.querySelector<HTMLElement>('mf-overlay-panel') as HTMLElement;
const field = <T extends HTMLElement>(name: string) =>
  panel().querySelector<T>(`[formcontrolname="${name}"]`) as T;
const button = (name: string) =>
  [...panel().querySelectorAll('button')].find(
    (b) => b.textContent?.trim() === name,
  ) as HTMLButtonElement | undefined;

function type(name: string, value: string) {
  const input = field<HTMLInputElement>(name);
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('the contact task', () => {
  it('opens as a drawer titled "Ajutor și contact" with the form', async () => {
    await open();

    expect(panel().textContent).toContain('Ajutor și contact');
    expect(panel().querySelector('mf-contact-form')).not.toBeNull();
    expect(panel().querySelector('[formcontrolname="role"]')).toBeNull();
  });

  it('fills name and e-mail from the account, editable, and sends what was typed', async () => {
    await open();

    expect(field<HTMLInputElement>('name').value).toBe('Ana Pop');
    expect(field<HTMLInputElement>('email').value).toBe('ana@example.test');
    type('name', 'Ana Maria Pop');
    const topic = field<HTMLSelectElement>('topic');
    topic.value = 'account';
    topic.dispatchEvent(new Event('change', { bubbles: true }));
    type('message', MESSAGE);
    button('Trimite mesajul')?.click();
    await settle();

    expect(send.mock.calls[0][0].body).toMatchObject({
      email: 'ana@example.test',
      name: 'Ana Maria Pop',
    });
    expect(send.mock.calls[0][0].body).not.toHaveProperty('role');
  });

  it('leaves the e-mail empty for an account without one', async () => {
    await open(null);

    expect(field<HTMLInputElement>('email').value).toBe('');
  });

  it('closes from the confirmation and returns the focus to the menu entry', async () => {
    const entry = await open();
    const topic = field<HTMLSelectElement>('topic');
    topic.value = 'other';
    topic.dispatchEvent(new Event('change', { bubbles: true }));
    type('message', MESSAGE);
    button('Trimite mesajul')?.click();
    await settle();

    button('Închide')?.click();
    await settle();

    await expect(result).resolves.toBe(true);
    expect(document.querySelector('mf-overlay-panel')).toBeNull();
    expect(document.activeElement).toBe(entry);
  });

  it('asks before closing once text was typed', async () => {
    await open();
    type('message', MESSAGE);

    panel()
      .closest('[role="dialog"]')
      ?.querySelector<HTMLButtonElement>('button.mf-overlay-close')
      ?.click();
    await settle();

    expect(
      document.querySelector('[role="alertdialog"]')?.textContent,
    ).toContain('Renunți la modificări?');
  });
});
