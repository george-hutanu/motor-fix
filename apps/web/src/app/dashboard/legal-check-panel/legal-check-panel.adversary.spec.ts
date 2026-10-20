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
  rarActivities: [],
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
const rowEl = (el: HTMLElement, kind: string) =>
  el.querySelector(`[data-legal-row="${kind}"]`);

afterEach(() => TestBed.resetTestingModule());

describe('the legal check panel adversary', () => {
  // @traces 210-FR-010
  it('shows nothing but the heading with no data, not loading, not failed', async () => {
    const el = (await render({})).nativeElement as HTMLElement;

    expect(el.querySelectorAll('[data-legal-row]').length).toBe(0);
    expect(el.querySelectorAll('[data-legal-skeleton]').length).toBe(0);
    expect(el.querySelector('[role="alert"]')).toBeNull();
  });

  // @traces 210-FR-010
  it('shows four busy skeleton rows while loading', async () => {
    const el = (await render({ loading: true })).nativeElement as HTMLElement;

    expect(el.querySelectorAll('[data-legal-skeleton]').length).toBe(4);
    expect(el.querySelector('[aria-busy="true"]')).not.toBeNull();
  });

  // @traces 210-FR-010
  it('shows the error and not the skeleton when failed and loading together', async () => {
    const el = (await render({ failed: true, loading: true }))
      .nativeElement as HTMLElement;

    expect(text(el.querySelector('[role="alert"]'))).toContain(
      'Nu am putut încărca verificarea',
    );
    expect(el.querySelectorAll('[data-legal-skeleton]').length).toBe(0);
  });

  // @traces 210-FR-010
  it('shows the English error and retry label', async () => {
    const el = (await render({ failed: true }, 'en'))
      .nativeElement as HTMLElement;

    expect(text(el.querySelector('[role="alert"]'))).toBe(
      'We could not load the check Try again',
    );
  });

  // @traces 210-FR-010
  it('emits retry on every click', async () => {
    const fixture = await render({ failed: true });
    const spy = jest.fn();
    fixture.componentInstance.retry.subscribe(spy);
    const button = fixture.nativeElement.querySelector(
      'button',
    ) as HTMLButtonElement;

    button.click();
    button.click();

    expect(spy).toHaveBeenCalledTimes(2);
  });

  // @traces 210-FR-010
  it('shows the error rather than stale rows when a read failed', async () => {
    const el = (await render({ data: answer(), failed: true }))
      .nativeElement as HTMLElement;

    expect(text(el.querySelector('[role="alert"]'))).toContain(
      'Nu am putut încărca verificarea',
    );
  });

  // @traces 210-FR-010
  it('shows no retry button when it is not failed', async () => {
    const el = (await render({ data: answer() })).nativeElement as HTMLElement;

    expect(el.querySelector('button')).toBeNull();
  });

  // @traces 210-FR-006
  it.each([
    ['ok', 'în regulă', 'green'],
    ['warning', 'atenție', 'amber'],
    ['failed', 'problemă', 'red'],
    ['not_run', 'neverificat', 'grey'],
  ] as const)('shows %s as text %s and lamp %s', async (state, word, lamp) => {
    const el = (
      await render({
        data: answer({
          rows: [
            row('company', { state }),
            row('caen'),
            row('rar'),
            row('documents'),
          ],
        }),
      })
    ).nativeElement as HTMLElement;
    const company = rowEl(el, 'company');

    expect(text(company?.querySelector('[data-legal-state]'))).toBe(word);
    expect(company?.getAttribute('data-lamp')).toBe(lamp);
  });

  // @traces 210-FR-006
  it('shows the recorded detail on a failed company row', async () => {
    const el = (
      await render({
        data: answer({
          rows: [
            row('company', { detail: 'CUI radiat', state: 'failed' }),
            row('caen'),
            row('rar'),
            row('documents'),
          ],
        }),
      })
    ).nativeElement as HTMLElement;

    expect(text(rowEl(el, 'company'))).toContain('CUI radiat');
  });

  // @traces 210-FR-006
  it('falls back to the standard detail on a warning with no recorded detail', async () => {
    const el = (
      await render({
        data: answer({
          rows: [
            row('company', { state: 'warning' }),
            row('caen'),
            row('rar'),
            row('documents'),
          ],
        }),
      })
    ).nativeElement as HTMLElement;

    expect(text(rowEl(el, 'company'))).toContain(
      'ATELIER DINAMO SRL · CUI verificat la ANAF și ONRC',
    );
  });

  // @traces 210-FR-006
  it('renders a company name with markup as text, not HTML', async () => {
    const el = (
      await render({
        data: answer({ companyName: '<img src=x onerror=alert(1)> & Co' }),
      })
    ).nativeElement as HTMLElement;

    expect(el.querySelector('img')).toBeNull();
    expect(text(rowEl(el, 'company'))).toContain(
      '<img src=x onerror=alert(1)> & Co',
    );
  });

  // @traces 210-FR-006
  it('shows an empty company name without crashing', async () => {
    const el = (await render({ data: answer({ companyName: '' }) }))
      .nativeElement as HTMLElement;

    expect(rowEl(el, 'company')).not.toBeNull();
  });

  // @traces 210-FR-007
  it('reads the registered seat for a mobile mechanic in Romanian', async () => {
    const el = (await render({ data: answer({ isMobile: true }) }))
      .nativeElement as HTMLElement;

    expect(text(rowEl(el, 'caen'))).toContain(', la sediul social');
    expect(text(rowEl(el, 'caen'))).not.toContain('punctul de lucru');
  });

  // @traces 210-FR-007
  it('reads the registered seat for a mobile mechanic in English', async () => {
    const el = (await render({ data: answer({ isMobile: true }) }, 'en'))
      .nativeElement as HTMLElement;

    expect(text(rowEl(el, 'caen'))).toContain(', at the registered seat');
  });

  // @traces 210-FR-007
  it('reads the workshop address for a fixed garage in English', async () => {
    const el = (await render({ data: answer() }, 'en'))
      .nativeElement as HTMLElement;

    expect(text(rowEl(el, 'caen'))).toContain(', at the workshop address');
  });

  // @traces 210-FR-006
  it('joins RAR activity names by comma and space, in each language', async () => {
    const data = answer({
      rarActivities: [
        { code: 'a', nameEn: 'brakes', nameRo: 'frâne' },
        { code: 'b', nameEn: 'tyres', nameRo: 'anvelope' },
      ],
    });

    const ro = (await render({ data })).nativeElement as HTMLElement;
    expect(text(rowEl(ro, 'rar'))).toContain('frâne, anvelope');
    TestBed.resetTestingModule();
    const en = (await render({ data }, 'en')).nativeElement as HTMLElement;
    expect(text(rowEl(en, 'rar'))).toContain('brakes, tyres');
  });

  // @traces 210-FR-006
  it('says "în registrul RAR" when no activity is covered', async () => {
    const el = (await render({ data: answer() })).nativeElement as HTMLElement;

    expect(text(rowEl(el, 'rar'))).toContain('în registrul RAR');
  });

  // @traces 210-FR-006
  it('shows each missing document kind on a warning documents row', async () => {
    const el = (
      await render({
        data: answer({
          rows: [
            row('company'),
            row('caen'),
            row('rar'),
            row('documents', {
              missing: ['onrc_certificate', 'rar_authorisation'],
              state: 'warning',
            }),
          ],
        }),
      })
    ).nativeElement as HTMLElement;
    const documents = text(rowEl(el, 'documents'));

    expect(documents).not.toContain(
      'certificat constatator și autorizație RAR',
    );
    expect(documents).toContain('atenție');
  });

  // @traces 210-FR-008
  it.each([
    ['ro', '2026-10-01', '1 oct. 2026'],
    ['en', '2026-10-01', '1 Oct 2026'],
    ['ro', '2026-12-31', '31 dec. 2026'],
    ['en', '2026-01-09', '9 Jan 2026'],
  ] as const)(
    'formats %s %s as %s on the rar row',
    async (lang, day, shown) => {
      const el = (
        await render(
          {
            data: answer({
              rows: [
                row('company'),
                row('caen'),
                row('rar', { checkedOn: day }),
                row('documents'),
              ],
            }),
          },
          lang,
        )
      ).nativeElement as HTMLElement;

      expect(text(rowEl(el, 'rar'))).toContain(shown);
    },
  );

  // @traces 210-FR-006
  it('shows "neverificat" as the checked line of a not_run row with a day', async () => {
    const el = (
      await render({
        data: answer({
          rows: [
            row('company'),
            row('caen'),
            row('rar', { checkedOn: '2026-10-01', state: 'not_run' }),
            row('documents'),
          ],
        }),
      })
    ).nativeElement as HTMLElement;

    expect(text(rowEl(el, 'rar'))).not.toContain('2026');
    expect(text(rowEl(el, 'rar'))).toContain('neverificat');
  });

  // @traces 210-FR-006
  it('does not crash on a malformed day', async () => {
    const el = (
      await render({
        data: answer({
          rows: [
            row('company'),
            row('caen'),
            row('rar', { checkedOn: 'not-a-date' }),
            row('documents'),
          ],
        }),
      })
    ).nativeElement as HTMLElement;

    expect(text(rowEl(el, 'rar'))).not.toContain('Invalid');
  });

  // @traces 210-FR-006
  it('renders an empty rows array as no rows', async () => {
    const el = (await render({ data: answer({ rows: [] }) }))
      .nativeElement as HTMLElement;

    expect(el.querySelectorAll('[data-legal-row]').length).toBe(0);
  });

  // @traces 210-FR-012
  it('updates when data changes after first render', async () => {
    const fixture = await render({ data: answer() });
    fixture.componentRef.setInput(
      'data',
      answer({
        rows: [
          row('company', { state: 'failed' }),
          row('caen'),
          row('rar'),
          row('documents'),
        ],
      }),
    );
    fixture.detectChanges();

    expect(
      text(
        rowEl(fixture.nativeElement, 'company')?.querySelector(
          '[data-legal-state]',
        ),
      ),
    ).toBe('problemă');
  });
});

const failedRar = (failure: 'expired' | 'suspended' | 'withdrawn' | null) =>
  answer({
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
        ...(failure ? { failure } : {}),
        state: 'failed',
      }),
      row('documents'),
    ],
    status: 'suspended',
  });

describe('the legal check panel after approval adversary', () => {
  // @traces 1354-FR-004
  it.each([
    ['expired', 'expirată pe 12 sept. 2026'],
    ['suspended', 'suspendată pe 12 sept. 2026'],
    ['withdrawn', 'retrasă pe 12 sept. 2026'],
  ] as const)(
    'says %s on the failed RAR row with the recorded detail',
    async (failure, said) => {
      const el = (await render({ data: failedRar(failure) }))
        .nativeElement as HTMLElement;
      const rar = rowEl(el, 'rar');

      expect(text(rar?.querySelector('.what'))).toContain(
        `${said} · Autorizația a expirat la 31 august`,
      );
      expect(rar?.getAttribute('data-lamp')).toBe('red');
      expect(text(rar?.querySelector('[data-legal-state]'))).toBe('problemă');
      expect(text(rar?.querySelector('.when'))).toBe(
        'reverificată pe 12 sept. 2026',
      );
    },
  );

  // @traces 1354-FR-004
  it('says expired in English on the failed RAR row', async () => {
    const el = (await render({ data: failedRar('expired') }, 'en'))
      .nativeElement as HTMLElement;
    const rar = rowEl(el, 'rar');

    expect(text(rar?.querySelector('.what'))).toContain(
      'expired on 12 Sep 2026',
    );
    expect(text(rar?.querySelector('.when'))).toBe('re-checked on 12 Sep 2026');
    expect(text(rar?.querySelector('[data-legal-state]'))).toBe('problem');
  });

  // @traces 1354-FR-004
  it('shows the failed RAR row without the dot when the recorded detail is empty', async () => {
    const data = failedRar('withdrawn');
    data.rows[2].detail = null;
    const el = (await render({ data })).nativeElement as HTMLElement;

    expect(text(rowEl(el, 'rar')?.querySelector('.what'))).not.toContain('·');
  });

  // @traces 1354-FR-004
  it('tags a suspended garage Suspendat and an approved one Verificat', async () => {
    const suspended = (await render({ data: failedRar('expired') }))
      .nativeElement as HTMLElement;
    const tag = suspended.querySelector('[data-legal-tag]');

    expect(text(tag)).toBe('Suspendat');
    expect(tag?.hasAttribute('data-suspended')).toBe(true);
    TestBed.resetTestingModule();
    const approved = (await render({ data: answer() }))
      .nativeElement as HTMLElement;

    expect(text(approved.querySelector('[data-legal-tag]'))).toBe('Verificat');
    expect(
      approved
        .querySelector('[data-legal-tag]')
        ?.hasAttribute('data-suspended'),
    ).toBe(false);
  });

  // @traces 1354-FR-004
  it('keeps the four ordinary rows for a suspension that was not a failed re-check', async () => {
    const el = (await render({ data: answer({ status: 'suspended' }) }))
      .nativeElement as HTMLElement;

    expect(text(el.querySelector('[data-legal-tag]'))).toBe('Suspendat');
    expect(rowEl(el, 'rar')?.getAttribute('data-lamp')).toBe('green');
    expect(text(rowEl(el, 'rar')?.querySelector('.when'))).toBe(
      'verificată pe 1 oct. 2026',
    );
  });

  // @traces 1354-FR-003
  it('says re-checked when the latest re-check is ok and on the stored day', async () => {
    const data = answer({
      latestRecheck: {
        checkedOn: '2026-10-01',
        detail: null,
        failure: null,
        result: 'ok',
      },
    });
    const el = (await render({ data })).nativeElement as HTMLElement;

    expect(text(rowEl(el, 'rar')?.querySelector('.when'))).toBe(
      'reverificată pe 1 oct. 2026',
    );
  });

  // @traces 1354-FR-003
  it('says checked, not re-checked, when the latest re-check predates the stored day', async () => {
    const data = answer({
      latestRecheck: {
        checkedOn: '2026-09-30',
        detail: null,
        failure: null,
        result: 'ok',
      },
    });
    const el = (await render({ data })).nativeElement as HTMLElement;

    expect(text(rowEl(el, 'rar')?.querySelector('.when'))).toBe(
      'verificată pe 1 oct. 2026',
    );
  });

  // @traces 1354-FR-003
  it('says checked in English for an approval-only garage', async () => {
    const el = (await render({ data: answer() }, 'en'))
      .nativeElement as HTMLElement;

    expect(text(rowEl(el, 'rar')?.querySelector('.when'))).toBe(
      'checked on 1 Oct 2026',
    );
  });

  // @traces 1354-FR-003
  it('says checked with no day when the stored date is empty', async () => {
    const data = answer({
      lastCheckedOn: null,
      rows: [
        row('company'),
        row('caen'),
        row('rar', { checkedOn: null }),
        row('documents'),
      ],
    });
    const el = (await render({ data })).nativeElement as HTMLElement;

    expect(text(rowEl(el, 'rar')?.querySelector('.when'))).toBe('verificată');
  });

  // @traces 1354-FR-006
  it.each([
    [
      'ro',
      'Reverificăm lunar autorizația în registrul RAR. Dacă e suspendată sau retrasă, profilul iese de pe hartă până se rezolvă.',
    ],
    [
      'en',
      'We re-check the authorisation in the RAR register every month. If it is suspended or withdrawn, the profile comes off the map until that is fixed.',
    ],
  ] as const)(
    'shows the monthly re-check note in %s after the rows',
    async (language, note) => {
      const el = (await render({ data: answer() }, language))
        .nativeElement as HTMLElement;
      const noteEl = el.querySelector('[data-legal-note]');

      expect(text(noteEl)).toBe(note);
      expect(
        el.querySelector('.rows')?.compareDocumentPosition(noteEl as Node),
      ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    },
  );

  // @traces 1354-FR-006
  it('shows no note while loading or after a failed read', async () => {
    const loading = (await render({ loading: true }))
      .nativeElement as HTMLElement;
    const failed = (await render({ failed: true }))
      .nativeElement as HTMLElement;

    expect(loading.querySelector('[data-legal-note]')).toBeNull();
    expect(failed.querySelector('[data-legal-note]')).toBeNull();
  });
});
