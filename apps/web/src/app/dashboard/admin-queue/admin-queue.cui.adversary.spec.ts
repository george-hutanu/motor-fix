import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { EventKind } from '@motor-fix/contracts';
import {
  AdminService,
  type VerificationQueueRowDto,
} from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';
import { NEVER } from 'rxjs';

import { AdminQueue } from './admin-queue';
import { Live } from '../live';

const row = (
  n: number,
  extra: Partial<VerificationQueueRowDto> = {},
): VerificationQueueRowDto => ({
  area: { kind: 'town', name: 'București' },
  brands: 7,
  flagged: false,
  garageId: `garage-${n}`,
  garageName: `Service ${n}`,
  id: `file-${n}`,
  lamp: 'green',
  mechanics: 3,
  resubmitted: false,
  status: 'submitted',
  submittedAt: new Date().toISOString(),
  summary: { en: 'Checked', ro: 'Verificat' },
  workingDays: 0,
  ...extra,
});

async function settle() {
  for (let i = 0; i < 5; i++) {
    TestBed.tick();
    await new Promise((resolve) => setTimeout(resolve));
  }
}

@Component({ imports: [AdminQueue], template: '<mf-admin-queue />' })
class Host {}

async function open(
  items: VerificationQueueRowDto[],
  language: 'ro' | 'en' = 'ro',
) {
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      {
        provide: Live,
        useValue: { on: (_: readonly EventKind[]) => NEVER, resync: NEVER },
      },
      {
        provide: AdminService,
        useValue: {
          adminOverviewControllerQueue: async () => ({
            items,
            total: items.length,
          }),
        },
      },
    ],
  });
  const i18n = TestBed.inject(I18n);
  if (language === 'en') await i18n.use('en');
  await i18n.enter('admin');
  const fixture = TestBed.createComponent(Host);
  document.body.append(fixture.nativeElement);
  await settle();
  return fixture.nativeElement as HTMLElement;
}

const cui = (el: HTMLElement) =>
  [...el.querySelectorAll('li.row')].map((r) =>
    r.querySelector('.cui')?.textContent?.replace(/\s+/g, ' ').trim(),
  );

afterEach(() => {
  TestBed.resetTestingModule();
  document.body.innerHTML = '';
});

// @traces 116-FR-012
describe('the queue line for a CUI warning with hostile names', () => {
  it('shows markup in a name as plain text and creates no element from it', async () => {
    const name = '<img src=x onerror=alert(1)><b>Rău</b>';

    const el = await open([row(1, { cuiWarning: name })]);

    expect(cui(el)).toEqual([`CUI folosit deja de: ${name}`]);
    expect(el.querySelector('li.row img')).toBeNull();
    expect(el.querySelector('li.row .cui b')).toBeNull();
  });

  it('does not expand placeholders written inside a name', async () => {
    const el = await open([row(1, { cuiWarning: 'Auto {names} {cui} {n}' })]);

    expect(cui(el)).toEqual(['CUI folosit deja de: Auto {names} {cui} {n}']);
  });

  it('keeps diacritics and non-latin names whole in both languages', async () => {
    const names = 'Șerban Țuțu, Автосервис, 修理店';

    const ro = await open([row(1, { cuiWarning: names })], 'ro');
    TestBed.resetTestingModule();
    document.body.innerHTML = '';
    const en = await open([row(1, { cuiWarning: names })], 'en');

    expect(cui(ro)).toEqual([`CUI folosit deja de: ${names}`]);
    expect(cui(en)).toEqual([`CUI already used by: ${names}`]);
  });

  it('shows no line for an empty warning, and shows one only on the rows that have it', async () => {
    const el = await open([
      row(1, { cuiWarning: '' }),
      row(2, { cuiWarning: 'Alt Service' }),
      row(3),
    ]);

    expect(cui(el)).toEqual([
      undefined,
      'CUI folosit deja de: Alt Service',
      undefined,
    ]);
  });

  it('shows a very long list of names without dropping any', async () => {
    const names = Array.from({ length: 300 }, (_, i) => `Service ${i}`).join(
      ', ',
    );

    const el = await open([row(1, { cuiWarning: names })]);

    expect(cui(el)).toEqual([`CUI folosit deja de: ${names}`]);
  });
});
