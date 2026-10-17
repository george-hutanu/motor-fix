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

const CATALOGUE = [
  { code: 'air_con', nameEn: 'Air conditioning', nameRo: 'Climatizare' },
  { code: 'brakes', nameEn: 'Brakes', nameRo: 'Frâne' },
  { code: 'mechanics', nameEn: 'Mechanics', nameRo: 'Mecanică' },
];
const JOBS = [
  {
    jobTypeId: 'job-oil',
    nameEn: 'Oil change',
    nameRo: 'Schimb de ulei',
    rarActivity: 'mechanics',
  },
  {
    jobTypeId: 'job-pads',
    nameEn: 'Brake pads',
    nameRo: 'Plăcuțe de frână',
    rarActivity: 'brakes',
  },
  {
    jobTypeId: 'job-wash',
    nameEn: 'Car wash',
    nameRo: 'Spălătorie',
    rarActivity: null,
  },
  {
    jobTypeId: 'job-ac',
    nameEn: 'A/C recharge',
    nameRo: 'Încărcare freon',
    rarActivity: 'air_con',
  },
];

@Component({
  imports: [VerificationRegisterForm],
  template: `<mf-verification-register-form
    fileId="file-1"
    [kind]="kind()"
    [result]="result()"
    [certificate]="certificate()"
    [mobile]="mobile()"
    [address]="address()"
    [rarNumber]="rarNumber()"
    [catalogue]="catalogue()"
    [jobs]="jobs()"
    [activities]="activities()"
    [document]="document()"
    (recorded)="recorded($event)"
    (decided)="decided()"
    (page)="page($event)"
  />`,
})
class Host {
  readonly kind = signal<'company' | 'caen' | 'rar' | 'activities'>('company');
  readonly result = signal<'not_run' | 'ok' | 'warning' | 'failed'>('not_run');
  readonly certificate = signal(true);
  readonly mobile = signal(false);
  readonly address = signal('Strada Fabricii 12, Cluj-Napoca');
  readonly rarNumber = signal<string | null>('B 1234/2019');
  readonly catalogue = signal(CATALOGUE);
  readonly jobs = signal(JOBS);
  readonly activities = signal<string[]>(['mechanics']);
  readonly document = signal<{
    line: string;
    buttons: { n: number; label: string; named: string }[];
  } | null>({
    buttons: [{ label: '1', n: 1, named: 'Pagina 1' }],
    line: 'Autorizația tehnică RAR · încărcată, 1 pagină',
  });
  readonly recorded = jest.fn();
  readonly decided = jest.fn();
  readonly page = jest.fn();
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

  const refused = (detail: string, errors: { code: string; field: string }[]) =>
    new HttpErrorResponse({
      error: { code: 'validation_failed', detail, errors, status: 400 },
      status: 400,
    });

  // @traces 203-FR-007 203-FR-009
  it("shows the server's refusal the same way, marking the tick at fault", async () => {
    await caen();
    record.mockRejectedValue(
      refused('Lipsește: la punctul de lucru', [
        { code: 'required', field: 'evidence.address' },
      ]),
    );

    await press('OK');
    await tick('4520 pe certificat');
    await tick('4520 în ONRC');
    await tick('la punctul de lucru');
    await press('Salvează');

    expect(text(alert())).toContain('Lipsește: la punctul de lucru');
    const box = tickBox('la punctul de lucru');
    expect(box?.getAttribute('aria-invalid')).toBe('true');
    expect(document.activeElement).toBe(box);
    expect(toast).not.toHaveBeenCalled();
  });

  // @traces 203-FR-007 203-FR-009
  it("reads the server's refusal in English", async () => {
    await mount((h) => h.kind.set('caen'), 'en');
    record.mockRejectedValue(
      refused('Lipsește: 4520 în ONRC', [
        { code: 'required', field: 'evidence.onrc' },
      ]),
    );

    await press('OK');
    await tick('4520 on the certificate');
    await tick('4520 in the ONRC record');
    await tick('at the workshop address');
    await press('Save');

    expect(text(alert())).toContain('Missing: 4520 in the ONRC record');
    expect(text(alert())).not.toContain('Lipsește');
    expect(
      tickBox('4520 in the ONRC record')?.getAttribute('aria-invalid'),
    ).toBe('true');
  });

  // @traces 203-FR-002 203-FR-009
  it("reads the server's CUI refusal in English", async () => {
    await mount(() => {}, 'en');
    record.mockRejectedValue(
      refused('CUI-ul service-ului nu e valid', [
        { code: 'invalid', field: 'cui' },
      ]),
    );

    await press('OK');
    await type('Company name', 'Auto Vest Motors SRL');
    await press('Save');

    expect(text(alert())).toContain("The garage's CUI is not valid");
    expect(text(alert())).not.toContain('CUI-ul');
  });

  it('names every tick for a screen reader and reads in English', async () => {
    await mount((h) => h.kind.set('caen'), 'en');

    expect(tickBox('4520 on the certificate')).not.toBeNull();
    expect(tickBox('4520 in the ONRC record')).not.toBeNull();
    expect(tickBox('at the workshop address')).not.toBeNull();
  });
});

describe('the RAR form', () => {
  // @traces 204-FR-008 204-FR-014
  const rar = (
    more: (host: Host) => void = () => {},
    language: 'ro' | 'en' = 'ro',
  ) =>
    mount((h) => {
      h.kind.set('rar');
      more(h);
    }, language);

  it('offers the three ticks, the number beside "găsită" and the address beneath the last', async () => {
    await rar();

    expect(tickBox('găsită')).not.toBeNull();
    expect(tickBox('aceeași firmă')).not.toBeNull();
    expect(tickBox('aceeași adresă')).not.toBeNull();
    expect(text(el)).toContain('B 1234/2019');
    expect(text(el)).toContain('Strada Fabricii 12, Cluj-Napoca');
    expect(field('Detaliu')).toBeNull();
  });

  it('reads the registered seat for a mobile mechanic', async () => {
    await rar((h) => h.mobile.set(true));

    expect(tickBox('același sediu social')).not.toBeNull();
    expect(tickBox('aceeași adresă')).toBeNull();
  });

  it('says the number is missing when the file holds none', async () => {
    await rar((h) => h.rarNumber.set(null));

    expect(text(el)).toContain('număr lipsă');
  });

  it('refuses OK with a tick missing before sending, naming it', async () => {
    await rar();

    await press('OK');
    await tick('găsită');
    await press('Salvează');

    expect(record).not.toHaveBeenCalled();
    expect(text(alert())).toContain('aceeași firmă');
    expect(text(alert())).toContain('aceeași adresă');
    expect(document.activeElement).toBe(tickBox('aceeași firmă'));
  });

  it('refuses OK when the file holds no number, whatever is ticked', async () => {
    await rar((h) => h.rarNumber.set(null));

    await press('OK');
    await tick('găsită');
    await tick('aceeași firmă');
    await tick('aceeași adresă');
    await press('Salvează');

    expect(record).not.toHaveBeenCalled();
    expect(text(alert())).toContain('Lipsește numărul RAR');
  });

  it('saves OK with the three ticks', async () => {
    await rar();

    await press('OK');
    await tick('găsită');
    await tick('aceeași firmă');
    await tick('aceeași adresă');
    await press('Salvează');

    expect(record).toHaveBeenCalledWith({
      body: {
        evidence: { found: true, sameAddress: true, sameCompany: true },
        result: 'ok',
      },
      id: 'file-1',
      kind: 'rar',
    });
  });

  it('proposes the detail for a number not found, and saves it as edited', async () => {
    await rar();

    await press('Problemă');

    expect(field('Detaliu')?.value).toBe(
      'numărul introdus nu există în registrul public RAR',
    );
    await type('Detaliu', 'Numărul aparține altei firme');
    await press('Salvează');

    expect(record).toHaveBeenCalledWith({
      body: {
        detail: 'Numărul aparține altei firme',
        evidence: { found: false, sameAddress: false, sameCompany: false },
        result: 'failed',
      },
      id: 'file-1',
      kind: 'rar',
    });
  });

  it('proposes nothing once "găsită" is ticked', async () => {
    await rar();

    await tick('găsită');
    await press('Problemă');

    expect(field('Detaliu')?.value).toBe('');
  });

  it('marks the tick the server refused', async () => {
    await rar();
    record.mockRejectedValueOnce(
      new HttpErrorResponse({
        error: {
          code: 'validation_failed',
          detail: 'Lipsește: aceeași firmă',
          errors: [{ code: 'required', field: 'evidence.sameCompany' }],
          status: 400,
        },
        status: 400,
      }),
    );

    await press('OK');
    await tick('găsită');
    await tick('aceeași firmă');
    await tick('aceeași adresă');
    await press('Salvează');

    expect(text(alert())).toContain('aceeași firmă');
    expect(tickBox('aceeași firmă')?.getAttribute('aria-invalid')).toBe('true');
  });

  it('reads in English', async () => {
    await rar((h) => h.rarNumber.set(null), 'en');

    expect(tickBox('found')).not.toBeNull();
    expect(tickBox('same company')).not.toBeNull();
    expect(tickBox('same address')).not.toBeNull();
    expect(text(el)).toContain('number missing');
  });
});

describe('the activities form', () => {
  // @traces 204-FR-004 204-FR-008 204-FR-014
  const activities = (
    more: (host: Host) => void = () => {},
    language: 'ro' | 'en' = 'ro',
  ) =>
    mount((h) => {
      h.kind.set('activities');
      more(h);
    }, language);
  const job = (name: string) =>
    [...el.querySelectorAll('[data-job]')].find((j) =>
      text(j).startsWith(name),
    );

  it('shows the authorisation beside the catalogue, pre-ticked from the stored list', async () => {
    await activities();

    expect(text(el.querySelector('[data-part="authorisation"]'))).toContain(
      'Autorizația tehnică RAR · încărcată, 1 pagină',
    );
    expect(tickBox('Mecanică')?.checked).toBe(true);
    expect(tickBox('Frâne')?.checked).toBe(false);
    expect(tickBox('Climatizare')?.checked).toBe(false);
  });

  it('opens a page of the authorisation through the drawer', async () => {
    await activities();

    await press('1');

    expect(host.page).toHaveBeenCalledWith(1);
  });

  it('says when no authorisation was uploaded', async () => {
    await activities((h) => h.document.set(null));

    expect(text(el)).toContain('fără autorizație încărcată');
  });

  it('marks each job covered or not covered as the ticks change', async () => {
    await activities();

    expect(text(job('Schimb de ulei'))).toContain('acoperit');
    expect(text(job('Plăcuțe de frână'))).toContain('neacoperit');
    expect(text(job('Spălătorie'))).not.toContain('neacoperit');

    await tick('Frâne');

    expect(text(job('Plăcuțe de frână'))).not.toContain('neacoperit');
    expect(text(job('Încărcare freon'))).toContain('neacoperit');
  });

  // @traces 204-FR-008
  it('marks a job mapped to a code outside the catalogue uncovered, with its code', async () => {
    await activities((h) =>
      h.jobs.set([
        ...JOBS,
        {
          jobTypeId: 'job-glass',
          nameEn: 'Windscreen',
          nameRo: 'Parbriz',
          rarActivity: 'glazing',
        },
      ]),
    );

    expect(text(job('Parbriz'))).toContain('neacoperit (cod glazing)');
    expect(text(job('Plăcuțe de frână'))).not.toContain('cod');
  });

  it('refuses OK with uncovered jobs, naming them', async () => {
    await activities();

    await press('OK');
    await press('Salvează');

    expect(record).not.toHaveBeenCalled();
    expect(text(alert())).toContain('Plăcuțe de frână');
    expect(text(alert())).toContain('Încărcare freon');
  });

  it('refuses OK with no activity ticked', async () => {
    await activities((h) => h.activities.set([]));

    await press('OK');
    await press('Salvează');

    expect(record).not.toHaveBeenCalled();
    expect(text(alert())).toContain('Bifează cel puțin o activitate');
  });

  it('saves OK with the ticked list when every job is covered', async () => {
    await activities();

    await press('OK');
    await tick('Frâne');
    await tick('Climatizare');
    await press('Salvează');

    expect(record).toHaveBeenCalledWith({
      body: { activities: ['air_con', 'brakes', 'mechanics'], result: 'ok' },
      id: 'file-1',
      kind: 'activities',
    });
  });

  it('proposes a detail naming the uncovered jobs for a warning', async () => {
    await activities();

    await press('Atenție');

    expect(field('Detaliu')?.value).toBe(
      'Plăcuțe de frână, Încărcare freon nu apar în autorizație',
    );
    await tick('Climatizare');
    expect(field('Detaliu')?.value).toBe(
      'Plăcuțe de frână nu apare în autorizație',
    );
    await press('Salvează');

    expect(record).toHaveBeenCalledWith({
      body: {
        activities: ['air_con', 'mechanics'],
        detail: 'Plăcuțe de frână nu apare în autorizație',
        result: 'warning',
      },
      id: 'file-1',
      kind: 'activities',
    });
  });

  it('keeps a typed detail when the ticks change', async () => {
    await activities();

    await press('Problemă');
    await type('Detaliu', 'Autorizație expirată');
    await tick('Frâne');

    expect(field('Detaliu')?.value).toBe('Autorizație expirată');
  });

  it("shows the server's uncovered refusal as it worded it", async () => {
    await activities((h) => h.jobs.set([]));
    record.mockRejectedValueOnce(
      new HttpErrorResponse({
        error: {
          code: 'validation_failed',
          detail: 'Nu sunt acoperite: job-x',
          errors: [
            { code: 'uncovered', field: 'evidence.uncoveredJobTypeIds' },
          ],
          status: 400,
        },
        status: 400,
      }),
    );

    await press('OK');
    await press('Salvează');

    expect(text(alert())).toContain('Nu sunt acoperite: job-x');
  });

  it('reads in English', async () => {
    await activities(() => {}, 'en');

    expect(tickBox('Mechanics')?.checked).toBe(true);
    expect(text(job('Brake pads'))).toContain('not covered');
    await press('Warning');
    expect(field('Detail')?.value).toBe(
      'Brake pads, A/C recharge are not on the authorisation',
    );
  });
});
