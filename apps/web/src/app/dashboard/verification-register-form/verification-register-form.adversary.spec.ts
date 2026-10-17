import { HttpErrorResponse } from '@angular/common/http';
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { AdminService } from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';
import { toast } from '@motor-fix/ui-cockpit';

import { VerificationRegisterForm } from './verification-register-form';

// @traces 203-FR-007 203-FR-008

jest.mock('@motor-fix/ui-cockpit', () => ({
  ...jest.requireActual('@motor-fix/ui-cockpit'),
  toast: jest.fn(),
}));

const ANSWER = {
  check: { id: 'c', kind: 'company', result: 'ok' },
  rarActivities: [],
  summary: { en: 'x', ro: 'x' },
};

@Component({
  imports: [VerificationRegisterForm],
  template: `<mf-verification-register-form
    fileId="file-1"
    [kind]="kind()"
    [result]="result()"
    [certificate]="certificate()"
    [mobile]="mobile()"
    [address]="address()"
    (recorded)="recorded($event)"
    (decided)="decided()"
  />`,
})
class Host {
  readonly kind = signal<'company' | 'caen'>('company');
  readonly result = signal<'not_run' | 'ok' | 'warning' | 'failed'>('not_run');
  readonly certificate = signal(true);
  readonly mobile = signal(false);
  readonly address = signal<string | null>('Strada Fabricii 12');
  readonly recorded = jest.fn();
  readonly decided = jest.fn();
}

let record: jest.Mock;
let host: Host;
let el: HTMLElement;

async function settle() {
  for (let i = 0; i < 6; i++) {
    TestBed.tick();
    await new Promise((resolve) => setTimeout(resolve));
  }
}

async function mount(
  set: (host: Host) => void = () => {},
  impl: () => Promise<unknown> = async () => ANSWER,
) {
  record = jest.fn(impl);
  jest.mocked(toast).mockClear();
  document.body.innerHTML = '';
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      {
        provide: AdminService,
        useValue: { verificationChecksControllerRecord: record },
      },
    ],
  });
  await TestBed.inject(I18n).enter('admin');
  const fixture = TestBed.createComponent(Host);
  host = fixture.componentInstance;
  set(host);
  el = fixture.nativeElement as HTMLElement;
  document.body.append(el);
  await settle();
}

const text = (node: Element | null | undefined) =>
  (node?.textContent ?? '').replace(/\s+/g, ' ').trim();
const button = (name: string) =>
  [...el.querySelectorAll('button')].find((b) => text(b) === name) ?? null;
const press = async (name: string) => {
  button(name)?.click();
  await settle();
};
const field = (label: string) => {
  const found = [...el.querySelectorAll('label')].find(
    (l) => text(l) === label,
  );
  const id = found?.getAttribute('for');
  return (id ? el.querySelector(`#${id}`) : null) as HTMLInputElement | null;
};
const tickBox = (label: string) =>
  ([...el.querySelectorAll('label')]
    .find((l) => text(l).startsWith(label))
    ?.querySelector('input[type="checkbox"]') ??
    null) as HTMLInputElement | null;
const save = async () => {
  (el.querySelector('button[type="submit"]') as HTMLButtonElement).click();
  await settle();
};

async function type(label: string, value: string) {
  const input = field(label) as HTMLInputElement;
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await settle();
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('the register form, attacked', () => {
  it('sends one call when save is pressed twice while the first is pending', async () => {
    let release!: () => void;
    await mount(
      () => {},
      () => new Promise((resolve) => (release = () => resolve(ANSWER))),
    );
    await press('OK');
    await type('Denumirea firmei', 'Auto Vest SRL');
    await save();
    await save();
    release();
    await settle();

    expect(record).toHaveBeenCalledTimes(1);
    expect(host.recorded).toHaveBeenCalledTimes(1);
  });

  it('sends one clear when "Resetează" is pressed twice', async () => {
    let release!: () => void;
    await mount(
      (h) => h.result.set('ok'),
      () => new Promise((resolve) => (release = () => resolve(ANSWER))),
    );
    button('Resetează')?.click();
    button('Resetează')?.click();
    release();
    await settle();

    expect(record).toHaveBeenCalledTimes(1);
    expect(record.mock.calls[0][0].body).toEqual({ result: 'not_run' });
  });

  it('refuses an OK with a name of spaces only', async () => {
    await mount();
    await press('OK');
    await type('Denumirea firmei', '   \t ');
    await save();

    expect(record).not.toHaveBeenCalled();
    expect(el.querySelector('[role="alert"]')).not.toBeNull();
  });

  it('sends no detail and no stale detail with OK after a warning was typed', async () => {
    await mount();
    await press('Atenție');
    await type('Detaliu', 'ceva ciudat');
    await press('OK');
    await type('Denumirea firmei', 'Auto Vest SRL');
    await save();

    expect(record.mock.calls[0][0].body).toEqual({
      evidence: { name: 'Auto Vest SRL' },
      result: 'ok',
    });
  });

  it('accepts a detail of exactly 200 characters and refuses 201 for a failure', async () => {
    await mount();
    await press('Problemă');
    await type('Detaliu', 'a'.repeat(200));
    await save();
    expect(record).toHaveBeenCalledTimes(1);

    await mount();
    await press('Problemă');
    await type('Detaliu', 'a'.repeat(201));
    await save();
    expect(record).not.toHaveBeenCalled();
  });

  it('refuses a detail holding a newline or tab', async () => {
    await mount();
    await press('Atenție');
    await type('Detaliu', 'prima\nA doua');
    await save();
    expect(record).not.toHaveBeenCalled();
  });

  it('trims the detail before sending', async () => {
    await mount();
    await press('Atenție');
    await type('Detaliu', '  nu se potrivește  ');
    await save();
    expect(record.mock.calls[0][0].body.detail).toBe('nu se potrivește');
  });

  it('refuses a save with no result chosen', async () => {
    await mount();
    await save();
    expect(record).not.toHaveBeenCalled();
    expect(el.querySelector('[role="alert"]')).not.toBeNull();
  });

  it('names every missing tick when none is ticked', async () => {
    await mount((h) => h.kind.set('caen'));
    await press('OK');
    await save();

    const alert = text(el.querySelector('[role="alert"]'));
    expect(record).not.toHaveBeenCalled();
    expect(alert).toContain('4520 pe certificat');
    expect(alert).toContain('4520 în ONRC');
    expect(alert).toContain('la punctul de lucru');
  });

  it('does not let an unticked box count after ticking and unticking it', async () => {
    await mount((h) => h.kind.set('caen'));
    await press('OK');
    for (const label of [
      '4520 pe certificat',
      '4520 în ONRC',
      'la punctul de lucru',
    ]) {
      tickBox(label)?.click();
      await settle();
    }
    tickBox('4520 în ONRC')?.click();
    await settle();
    await save();

    expect(record).not.toHaveBeenCalled();
  });

  it('sends the certificate tick when the file holds no certificate only if it is absent from the form', async () => {
    await mount((h) => {
      h.kind.set('caen');
      h.certificate.set(false);
    });
    await press('Atenție');
    await type('Detaliu', 'nu e pe certificat');
    await save();

    expect(record.mock.calls[0][0].body.evidence).toEqual({
      address: false,
      onrc: false,
    });
  });

  it('does not send company evidence with a caen record or the other way round', async () => {
    await mount((h) => h.kind.set('caen'));
    await press('Problemă');
    await type('Detaliu', 'x');
    await save();

    expect(record.mock.calls[0][0].kind).toBe('caen');
    expect(record.mock.calls[0][0].body.evidence).not.toHaveProperty('name');
  });

  it('shows no address note for a mobile mechanic without a seat address', async () => {
    await mount((h) => {
      h.kind.set('caen');
      h.mobile.set(true);
      h.address.set(null);
    });

    expect(text(el)).toContain('la sediul social');
    expect(text(el)).not.toContain('null');
    expect(text(el)).not.toContain('undefined');
  });

  it('keeps the form and toasts on a network failure that is not an HTTP error', async () => {
    await mount(
      () => {},
      async () => {
        throw new TypeError('Failed to fetch');
      },
    );
    await press('OK');
    await type('Denumirea firmei', 'Auto Vest SRL');
    await save();

    expect(toast).toHaveBeenCalledTimes(1);
    expect(field('Denumirea firmei')?.value).toBe('Auto Vest SRL');
    expect(host.recorded).not.toHaveBeenCalled();
    expect(host.decided).not.toHaveBeenCalled();
  });

  it('toasts on a 409 that is not a decided file', async () => {
    await mount(
      () => {},
      async () => {
        throw new HttpErrorResponse({
          error: { code: 'something_else' },
          status: 409,
        });
      },
    );
    await press('OK');
    await type('Denumirea firmei', 'X');
    await save();

    expect(host.decided).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledTimes(1);
  });

  // The API's problem filter joins a list of validation messages into the
  // problem's detail.
  it('shows the server refusal of a validation error made of several messages', async () => {
    await mount(
      () => {},
      async () => {
        throw new HttpErrorResponse({
          error: {
            code: 'validation_failed',
            detail: 'evidence.name must be shorter; evidence.onrc missing',
            status: 400,
          },
          status: 400,
        });
      },
    );
    await press('OK');
    await type('Denumirea firmei', 'X');
    await save();

    expect(text(el.querySelector('[role="alert"]'))).toContain(
      'evidence.name must be shorter',
    );
    expect(toast).not.toHaveBeenCalled();
  });

  it('clears an earlier refusal once the admin picks another result', async () => {
    await mount();
    await press('OK');
    await save();
    expect(el.querySelector('[role="alert"]')).not.toBeNull();
    await press('Atenție');

    expect(el.querySelector('[role="alert"]')).toBeNull();
  });

  it('does not render markup typed into the name as HTML', async () => {
    await mount();
    await press('OK');
    await type('Denumirea firmei', '<img src=x onerror=alert(1)>');
    await save();

    expect(el.querySelector('img')).toBeNull();
    expect(record.mock.calls[0][0].body.evidence.name).toBe(
      '<img src=x onerror=alert(1)>',
    );
  });
});
