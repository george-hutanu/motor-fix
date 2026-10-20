import { TestBed } from '@angular/core/testing';
import type { LegalCheckDto, LegalCheckRowDto } from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';

import { LegalCheckPanel } from './legal-check-panel';

const row = (
  kind: LegalCheckRowDto['kind'],
  over: Partial<LegalCheckRowDto> = {},
): LegalCheckRowDto => ({
  checkedOn: '2026-10-01',
  detail: null,
  kind,
  missing: [],
  state: 'ok',
  ...over,
});

const answer = (over: Partial<LegalCheckDto> = {}): LegalCheckDto => ({
  companyName: 'ATELIER DINAMO SRL',
  isMobile: false,
  lastCheckedOn: '2026-10-01',
  latestRecheck: null,
  rarActivities: [
    { code: 'mechanics', nameEn: 'mechanics', nameRo: 'mecanică' },
    { code: 'brakes', nameEn: 'brakes', nameRo: 'frâne' },
  ],
  rows: [row('company'), row('caen'), row('rar'), row('documents')],
  status: 'approved',
  ...over,
});

async function render(
  inputs: { data?: LegalCheckDto; loading?: boolean; failed?: boolean },
  language: 'ro' | 'en' = 'ro',
) {
  const i18n = TestBed.inject(I18n);
  await i18n.enter('garage');
  if (language === 'en') await i18n.use('en');
  const fixture = TestBed.createComponent(LegalCheckPanel);
  fixture.componentRef.setInput('data', inputs.data);
  fixture.componentRef.setInput('loading', inputs.loading ?? false);
  fixture.componentRef.setInput('failed', inputs.failed ?? false);
  fixture.detectChanges();
  await fixture.whenStable();
  return fixture;
}

const text = (el: Element | null | undefined) =>
  (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
const rows = (el: HTMLElement) =>
  Array.from(el.querySelectorAll('[data-legal-row]'));

afterEach(() => TestBed.resetTestingModule());

// @traces 210-FR-006
// @traces 210-FR-012
describe('the legal check panel', () => {
  it('heads the four rows with "Verificare legală" and the "Verificat" tag', async () => {
    const element = (await render({ data: answer() })).nativeElement;

    expect(text(element.querySelector('h2'))).toBe('Verificare legală');
    expect(text(element.querySelector('[data-legal-tag]'))).toBe('Verificat');
    expect(rows(element).map((r) => r.getAttribute('data-legal-row'))).toEqual([
      'company',
      'caen',
      'rar',
      'documents',
    ]);
  });

  it('reads each row as the board does, in Romanian', async () => {
    const element = (await render({ data: answer() })).nativeElement;
    const [company, caen, rar, documents] = rows(element).map(text);

    expect(company).toBe(
      'Firmă activă ATELIER DINAMO SRL · CUI verificat la ANAF și ONRC verificat la înscriere în regulă',
    );
    expect(caen).toBe(
      'Cod CAEN 4520 Întreținerea și repararea autovehiculelor, la punctul de lucru din certificatul constatator în regulă',
    );
    expect(rar).toBe(
      'Autorizație tehnică RAR mecanică, frâne verificată pe 1 oct. 2026 în regulă',
    );
    expect(documents).toBe(
      'Documente certificat constatator și autorizație RAR verificate pe 1 oct. 2026 în regulă',
    );
  });

  it('reads the same in English', async () => {
    const element = (await render({ data: answer() }, 'en')).nativeElement;
    const [company, caen, rar, documents] = rows(element).map(text);

    expect(text(element.querySelector('h2'))).toBe('Legal check');
    expect(text(element.querySelector('[data-legal-tag]'))).toBe('Verified');
    expect(company).toBe(
      'Active company ATELIER DINAMO SRL · tax ID checked at ANAF and ONRC checked at sign-up in order',
    );
    expect(caen).toBe(
      'CAEN code 4520 Maintenance and repair of motor vehicles, at the workshop address from the company certificate in order',
    );
    expect(rar).toBe(
      'RAR technical authorisation mechanics, brakes checked on 1 Oct 2026 in order',
    );
    expect(documents).toBe(
      'Documents company certificate and RAR authorisation checked on 1 Oct 2026 in order',
    );
  });

  it('names the RAR register when no activity is recorded', async () => {
    const element = (await render({ data: answer({ rarActivities: [] }) }))
      .nativeElement;

    expect(text(rows(element)[2])).toContain('în registrul RAR');
  });
});

// @traces 210-FR-007
describe('the CAEN row of a mobile mechanic', () => {
  it('names the registered seat instead of the workshop', async () => {
    const element = (await render({ data: answer({ isMobile: true }) }))
      .nativeElement;

    expect(text(rows(element)[1])).toContain(
      'Întreținerea și repararea autovehiculelor, la sediul social',
    );
  });

  it('says so in English', async () => {
    const element = (await render({ data: answer({ isMobile: true }) }, 'en'))
      .nativeElement;

    expect(text(rows(element)[1])).toContain(
      'Maintenance and repair of motor vehicles, at the registered seat',
    );
  });
});

// @traces 210-FR-006
describe('a row state', () => {
  it.each([
    ['ok', 'în regulă', 'green'],
    ['warning', 'atenție', 'amber'],
    ['failed', 'problemă', 'red'],
    ['not_run', 'neverificat', 'grey'],
  ] as const)('shows %s by text and colour', async (state, label, lamp) => {
    const data = answer({
      rows: [
        row('company', { state }),
        row('caen'),
        row('rar'),
        row('documents'),
      ],
    });
    const element = (await render({ data })).nativeElement;
    const company = rows(element)[0];

    expect(text(company?.querySelector('[data-legal-state]'))).toBe(label);
    expect(company?.getAttribute('data-lamp')).toBe(lamp);
  });

  it("shows a warning's own detail as its detail line", async () => {
    const data = answer({
      rows: [
        row('company'),
        row('caen', { detail: 'Cod CAEN secundar', state: 'warning' }),
        row('rar'),
        row('documents'),
      ],
    });
    const element = (await render({ data })).nativeElement;

    expect(text(rows(element)[1])).toBe(
      'Cod CAEN 4520 Cod CAEN secundar din certificatul constatator atenție',
    );
  });

  it('says a check that has not run was not checked', async () => {
    const data = answer({
      rows: [
        row('company'),
        row('caen'),
        row('rar', { checkedOn: null, state: 'not_run' }),
        row('documents'),
      ],
    });
    const element = (await render({ data })).nativeElement;

    expect(text(rows(element)[2])).toBe(
      'Autorizație tehnică RAR mecanică, frâne neverificat neverificat',
    );
  });

  it('names the documents that are missing on a warning', async () => {
    const data = answer({
      rows: [
        row('company'),
        row('caen'),
        row('rar'),
        row('documents', {
          missing: ['rar_authorisation'],
          state: 'warning',
        }),
      ],
    });
    const element = (await render({ data })).nativeElement;

    expect(text(rows(element)[3])).toContain('lipsește autorizația RAR');
  });
});

// @traces 210-FR-008
describe('dates in the panel', () => {
  it('are the Bucharest day, short month, in each language', async () => {
    const data = answer({
      lastCheckedOn: '2026-12-31',
      rows: [
        row('company'),
        row('caen'),
        row('rar', { checkedOn: '2026-05-09' }),
        row('documents', { checkedOn: '2026-12-31' }),
      ],
    });
    let element = (await render({ data })).nativeElement;
    expect(text(rows(element)[2])).toContain('verificată pe 9 mai 2026');
    expect(text(rows(element)[3])).toContain('verificate pe 31 dec. 2026');
    TestBed.resetTestingModule();

    element = (await render({ data }, 'en')).nativeElement;
    expect(text(rows(element)[2])).toContain('checked on 9 May 2026');
    expect(text(rows(element)[3])).toContain('checked on 31 Dec 2026');
  });
});

// @traces 210-FR-010
describe('while the panel loads or fails', () => {
  it('shows four skeleton rows, busy', async () => {
    const element = (await render({ loading: true })).nativeElement;

    expect(element.querySelectorAll('[data-legal-skeleton]')).toHaveLength(4);
    expect(element.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(rows(element)).toHaveLength(0);
  });

  it('says the check could not be loaded and offers to try again', async () => {
    const fixture = await render({ failed: true });
    const element: HTMLElement = fixture.nativeElement;
    const retried = jest.fn();
    fixture.componentInstance.retry.subscribe(retried);

    expect(text(element.querySelector('[role="alert"]'))).toContain(
      'Nu am putut încărca verificarea',
    );
    const button = element.querySelector<HTMLButtonElement>(
      '[role="alert"] button',
    );
    expect(text(button)).toBe('Încearcă din nou');
    button?.click();
    expect(retried).toHaveBeenCalledTimes(1);
  });

  it('says so in English', async () => {
    const element = (await render({ failed: true }, 'en')).nativeElement;

    expect(text(element.querySelector('[role="alert"]'))).toBe(
      'We could not load the check Try again',
    );
  });
});

const OK_RECHECK = {
  checkedOn: '2026-10-01',
  detail: null,
  failure: null,
  result: 'ok',
} as const;

// @traces 1354-FR-003
describe('the RAR row after a monthly re-check', () => {
  it('reads re-checked on the stored day once an ok re-check is recorded', async () => {
    const element = (
      await render({ data: answer({ latestRecheck: OK_RECHECK }) })
    ).nativeElement;

    expect(text(rows(element)[2])).toBe(
      'Autorizație tehnică RAR mecanică, frâne reverificată pe 1 oct. 2026 în regulă',
    );
  });

  it('reads the same in English', async () => {
    const element = (
      await render({ data: answer({ latestRecheck: OK_RECHECK }) }, 'en')
    ).nativeElement;

    expect(text(rows(element)[2])).toBe(
      'RAR technical authorisation mechanics, brakes re-checked on 1 Oct 2026 in order',
    );
  });

  it('reads checked on when the ok re-check predates the stored day', async () => {
    const element = (
      await render({
        data: answer({
          lastCheckedOn: '2026-10-01',
          latestRecheck: { ...OK_RECHECK, checkedOn: '2026-06-14' },
        }),
      })
    ).nativeElement;

    expect(text(rows(element)[2])).toContain('verificată pe 1 oct. 2026');
    expect(text(rows(element)[2])).not.toContain('reverificată');
  });
});

// @traces 1354-FR-006
describe('the note under the rows', () => {
  it('says the authorisation is re-checked monthly', async () => {
    const element = (await render({ data: answer() })).nativeElement;

    expect(text(element.querySelector('[data-legal-note]'))).toBe(
      'Reverificăm lunar autorizația în registrul RAR. Dacă e suspendată sau retrasă, profilul iese de pe hartă până se rezolvă.',
    );
  });

  it('says the same in English', async () => {
    const element = (await render({ data: answer() }, 'en')).nativeElement;

    expect(text(element.querySelector('[data-legal-note]'))).toBe(
      'We re-check the authorisation in the RAR register every month. If it is suspended or withdrawn, the profile comes off the map until that is fixed.',
    );
  });
});

const failedRar = (failure: 'expired' | 'suspended' | 'withdrawn') =>
  answer({
    lastCheckedOn: '2026-08-10',
    latestRecheck: {
      checkedOn: '2026-09-12',
      detail: 'Autorizația a expirat la 31 august',
      failure,
      result: 'failed',
    },
    rows: [
      row('company'),
      row('caen'),
      row('rar', {
        checkedOn: '2026-09-12',
        detail: 'Autorizația a expirat la 31 august',
        failure,
        state: 'failed',
      }),
      row('documents'),
    ],
    status: 'suspended',
  });

// @traces 1354-FR-004
describe('the panel of a suspended garage', () => {
  it('tags it Suspendat in red', async () => {
    const tag = (
      await render({ data: answer({ status: 'suspended' }) })
    ).nativeElement.querySelector('[data-legal-tag]');

    expect(text(tag)).toBe('Suspendat');
    expect(tag.hasAttribute('data-suspended')).toBe(true);
  });

  it('tags it Suspended in English', async () => {
    const element = (
      await render({ data: answer({ status: 'suspended' }) }, 'en')
    ).nativeElement;

    expect(text(element.querySelector('[data-legal-tag]'))).toBe('Suspended');
  });

  it('keeps the Verificat tag, unmarked, for an approved garage', async () => {
    const tag = (await render({ data: answer() })).nativeElement.querySelector(
      '[data-legal-tag]',
    );

    expect(tag.hasAttribute('data-suspended')).toBe(false);
  });

  it.each([
    ['expired', 'expirată pe 12 sept. 2026'],
    ['suspended', 'suspendată pe 12 sept. 2026'],
    ['withdrawn', 'retrasă pe 12 sept. 2026'],
  ] as const)(
    'shows the failed re-check on a red RAR row when it was %s',
    async (failure, said) => {
      const rar = rows(
        (await render({ data: failedRar(failure) })).nativeElement,
      )[2];

      expect(text(rar)).toBe(
        `Autorizație tehnică RAR ${said} · Autorizația a expirat la 31 august reverificată pe 12 sept. 2026 problemă`,
      );
      expect(rar.getAttribute('data-lamp')).toBe('red');
    },
  );

  it('shows the failed re-check in English', async () => {
    const rar = rows(
      (await render({ data: failedRar('withdrawn') }, 'en')).nativeElement,
    )[2];

    expect(text(rar)).toBe(
      'RAR technical authorisation withdrawn on 12 Sep 2026 · Autorizația a expirat la 31 august re-checked on 12 Sep 2026 problem',
    );
  });
});
