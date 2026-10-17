import { HttpErrorResponse } from '@angular/common/http';
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { AdminService } from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';
import { toast } from '@motor-fix/ui-cockpit';

import { VerificationRegisterForm } from './verification-register-form';

// @traces 203-FR-007 203-FR-009

jest.mock('@motor-fix/ui-cockpit', () => ({
  ...jest.requireActual('@motor-fix/ui-cockpit'),
  toast: jest.fn(),
}));

const ANSWER = {
  check: {
    automatic: false,
    detail: 'CUI valid · Auto Vest Motors SRL',
    evidence: { lookedUpOn: '2026-10-17', name: 'Auto Vest Motors SRL' },
    fileId: 'file-1',
    id: 'check-company',
    kind: 'company',
    recordedAt: '2026-10-17T09:00:00.000Z',
    recordedBy: 'admin-1',
    result: 'ok',
  },
  rarActivities: [],
  summary: { en: 'Company ID checked', ro: 'CUI verificat' },
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
  readonly address = signal('Strada Fabricii 12, Cluj-Napoca');
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
  language: 'ro' | 'en' = 'ro',
) {
  record = jest.fn(async () => ANSWER);
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
  const i18n = TestBed.inject(I18n);
  if (language === 'en') await i18n.use('en');
  await i18n.enter('admin');
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
const alert = () => el.querySelector('[role="alert"]');

async function type(label: string, value: string) {
  const input = field(label) as HTMLInputElement;
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await settle();
}

async function tick(label: string) {
  tickBox(label)?.click();
  await settle();
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('the company form', () => {
  it('offers the three results and the company name, with no detail field for OK', async () => {
    await mount();

    expect(button('OK')).not.toBeNull();
    expect(button('Atenție')).not.toBeNull();
    expect(button('Problemă')).not.toBeNull();
    expect(field('Denumirea firmei')).not.toBeNull();
    expect(field('Detaliu')).toBeNull();

    await press('Atenție');
    expect(button('Atenție')?.getAttribute('aria-pressed')).toBe('true');
    expect(field('Detaliu')?.getAttribute('maxlength')).toBe('200');
  });

  it('moves focus to its first control when it opens', async () => {
    await mount();

    expect(document.activeElement).toBe(button('OK'));
  });

  it('offers "Resetează" only once the row has a result', async () => {
    await mount();
    expect(button('Resetează')).toBeNull();

    await mount((h) => h.result.set('ok'));
    expect(button('Resetează')).not.toBeNull();
  });

  it('refuses OK without a name before sending, naming the field and announcing it', async () => {
    await mount();

    await press('OK');
    await press('Salvează');

    expect(record).not.toHaveBeenCalled();
    expect(text(alert())).toContain('Denumirea firmei');
    const name = field('Denumirea firmei');
    expect(name?.getAttribute('aria-invalid')).toBe('true');
    expect(name?.getAttribute('aria-describedby')).toContain(
      alert()?.id ?? 'none',
    );
    expect(document.activeElement).toBe(name);
  });

  it('saves OK with the trimmed name and hands the answer up', async () => {
    await mount();

    await press('OK');
    await type('Denumirea firmei', '  Auto Vest Motors SRL ');
    await press('Salvează');

    expect(record).toHaveBeenCalledWith({
      body: { evidence: { name: 'Auto Vest Motors SRL' }, result: 'ok' },
      id: 'file-1',
      kind: 'company',
    });
    expect(host.recorded).toHaveBeenCalledWith(ANSWER);
  });

  it('needs a detail of 1 to 200 characters for a warning or a failure', async () => {
    await mount();

    await press('Problemă');
    await press('Salvează');
    expect(record).not.toHaveBeenCalled();
    expect(text(alert())).toContain('Detaliu');

    await type('Detaliu', 'x'.repeat(201));
    await press('Salvează');
    expect(record).not.toHaveBeenCalled();

    await type('Detaliu', ' Firma e radiată ');
    await press('Salvează');
    expect(record).toHaveBeenCalledWith({
      body: { detail: 'Firma e radiată', result: 'failed' },
      id: 'file-1',
      kind: 'company',
    });
  });

  it('keeps what was typed and says so in a toast when the save fails', async () => {
    await mount();
    record.mockRejectedValue(new HttpErrorResponse({ status: 0 }));

    await press('OK');
    await type('Denumirea firmei', 'Auto Vest Motors SRL');
    await press('Salvează');

    expect(toast).toHaveBeenCalledWith('Nu am putut salva verificarea');
    expect(field('Denumirea firmei')?.value).toBe('Auto Vest Motors SRL');
    expect(host.recorded).not.toHaveBeenCalled();
  });

  it('tells the drawer when the file was decided meanwhile', async () => {
    await mount();
    record.mockRejectedValue(
      new HttpErrorResponse({
        error: { code: 'verification_file_decided', status: 409 },
        status: 409,
      }),
    );

    await press('OK');
    await type('Denumirea firmei', 'Auto Vest Motors SRL');
    await press('Salvează');

    expect(host.decided).toHaveBeenCalled();
    expect(toast).not.toHaveBeenCalled();
  });

  it('clears the check with "Resetează"', async () => {
    await mount((h) => h.result.set('warning'));

    await press('Resetează');

    expect(record).toHaveBeenCalledWith({
      body: { result: 'not_run' },
      id: 'file-1',
      kind: 'company',
    });
    expect(host.recorded).toHaveBeenCalledWith(ANSWER);
  });

  it('reads in English', async () => {
    await mount(() => {}, 'en');

    expect(button('Warning')).not.toBeNull();
    expect(button('Failure')).not.toBeNull();
    expect(field('Company name')).not.toBeNull();
  });
});

describe('the CAEN form', () => {
  const caen = (more: (host: Host) => void = () => {}) =>
    mount((h) => {
      h.kind.set('caen');
      more(h);
    });

  it('offers the three ticks, the address beneath the last', async () => {
    await caen();

    expect(tickBox('4520 pe certificat')).not.toBeNull();
    expect(tickBox('4520 în ONRC')).not.toBeNull();
    expect(tickBox('la punctul de lucru')).not.toBeNull();
    expect(text(el)).toContain('Strada Fabricii 12, Cluj-Napoca');
    expect(field('Denumirea firmei')).toBeNull();
  });

  it('leaves the certificate tick out when no certificate was uploaded', async () => {
    await caen((h) => h.certificate.set(false));

    expect(tickBox('4520 pe certificat')).toBeNull();
  });

  it('reads the registered seat for a mobile mechanic', async () => {
    await caen((h) => {
      h.mobile.set(true);
      h.address.set('Strada Lungă 3, Brașov');
    });

    expect(tickBox('la sediul social')).not.toBeNull();
    expect(tickBox('la punctul de lucru')).toBeNull();
    expect(text(el)).toContain('Strada Lungă 3, Brașov');
  });

  it('refuses OK with a tick missing before sending, naming it', async () => {
    await caen();

    await press('OK');
    await tick('4520 în ONRC');
    await press('Salvează');

    expect(record).not.toHaveBeenCalled();
    expect(text(alert())).toContain('4520 pe certificat');
    expect(text(alert())).toContain('la punctul de lucru');
    expect(text(alert())).not.toContain('4520 în ONRC');
    expect(document.activeElement).toBe(tickBox('4520 pe certificat'));
  });

  it('saves OK with the three ticks', async () => {
    await caen();

    await press('OK');
    await tick('4520 pe certificat');
    await tick('4520 în ONRC');
    await tick('la punctul de lucru');
    await press('Salvează');

    expect(record).toHaveBeenCalledWith({
      body: {
        evidence: { address: true, certificate: true, onrc: true },
        result: 'ok',
      },
      id: 'file-1',
      kind: 'caen',
    });
  });

  it('saves OK with two ticks when there is no certificate', async () => {
    await caen((h) => h.certificate.set(false));

    await press('OK');
    await tick('4520 în ONRC');
    await tick('la punctul de lucru');
    await press('Salvează');

    expect(record).toHaveBeenCalledWith({
      body: { evidence: { address: true, onrc: true }, result: 'ok' },
      id: 'file-1',
      kind: 'caen',
    });
  });

  it('stores the ticks as they are with a warning', async () => {
    await caen();

    await press('Atenție');
    await tick('4520 în ONRC');
    await type('Detaliu', 'Codul lipsește din certificat');
    await press('Salvează');

    expect(record).toHaveBeenCalledWith({
      body: {
        detail: 'Codul lipsește din certificat',
        evidence: { address: false, certificate: false, onrc: true },
        result: 'warning',
      },
      id: 'file-1',
      kind: 'caen',
    });
  });

  it("shows the server's refusal the same way", async () => {
    await caen();
    record.mockRejectedValue(
      new HttpErrorResponse({
        error: {
          code: 'validation_failed',
          detail: 'Lipsește: 4520 pe certificat',
          status: 400,
        },
        status: 400,
      }),
    );

    await press('OK');
    await tick('4520 pe certificat');
    await tick('4520 în ONRC');
    await tick('la punctul de lucru');
    await press('Salvează');

    expect(text(alert())).toContain('Lipsește: 4520 pe certificat');
    expect(toast).not.toHaveBeenCalled();
  });

  it('names every tick for a screen reader and reads in English', async () => {
    await mount((h) => h.kind.set('caen'), 'en');

    expect(tickBox('4520 on the certificate')).not.toBeNull();
    expect(tickBox('4520 in the ONRC record')).not.toBeNull();
    expect(tickBox('at the workshop address')).not.toBeNull();
  });
});
