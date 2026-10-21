import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { TestBed } from '@angular/core/testing';
import type { VerificationStageStatus } from '@motor-fix/contracts';
import { I18n } from '@motor-fix/i18n';

import { VerificationStages } from './verification-stages';

const OFF_MAP =
  'Profilul nu apare pe hartă până la aprobare. Dacă lipsește ceva, îți scriem ce anume și poți completa fără să o iei de la capăt.';

async function render(
  inputs: {
    status: VerificationStageStatus;
    requestedItems?: string[];
    reason?: { code: string; note: string } | null;
  },
  language: 'ro' | 'en' = 'ro',
) {
  const i18n = TestBed.inject(I18n);
  await i18n.enter('public');
  if (language === 'en') await i18n.use('en');
  const fixture = TestBed.createComponent(VerificationStages);
  for (const [key, value] of Object.entries(inputs))
    fixture.componentRef.setInput(key, value);
  fixture.detectChanges();
  await fixture.whenStable();
  return fixture.nativeElement as HTMLElement;
}

const text = (element: Element | null | undefined) =>
  (element?.textContent ?? '').replace(/\s+/g, ' ').trim();
const stages = (host: HTMLElement) => [
  ...host.querySelectorAll<HTMLElement>('ol.stages > li'),
];
const names = (host: HTMLElement) =>
  stages(host).map((li) => text(li.querySelector('.name')));
const lit = (host: HTMLElement) =>
  stages(host).map((li) => li.classList.contains('lit'));
const currentAt = (host: HTMLElement) =>
  stages(host).findIndex((li) => li.getAttribute('aria-current') === 'step');

describe('the verification stages', () => {
  afterEach(() => TestBed.resetTestingModule());

  // @traces 116-FR-015
  it('names the three stages in Romanian, lights the first for a sent file and says it stays off the map', async () => {
    const host = await render({ status: 'submitted' });

    expect(names(host)).toEqual([
      'Trimis',
      'În verificare',
      'Aprobat, pe hartă',
    ]);
    expect(lit(host)).toEqual([true, false, false]);
    expect(currentAt(host)).toBe(0);
    expect(text(host.querySelector('.off-map'))).toBe(OFF_MAP);
    expect(host.querySelector('ol.stages')?.getAttribute('aria-label')).toBe(
      'Stadiul verificării',
    );
  });

  // @traces 116-FR-015
  it('speaks English', async () => {
    const host = await render({ status: 'submitted' }, 'en');

    expect(names(host)).toEqual([
      'Submitted',
      'Under review',
      'Approved, on the map',
    ]);
    expect(text(host.querySelector('.off-map'))).toBe(
      'The profile stays off the map until it is approved. If something is missing we tell you what, and you can add it without starting over.',
    );
  });

  // @traces 116-FR-015
  it.each([
    ['draft', [false, false, false], -1, true],
    ['submitted', [true, false, false], 0, true],
    ['in_review', [true, true, false], 1, true],
    ['more_requested', [true, true, false], 1, true],
    ['rejected', [true, true, false], 1, true],
    ['approved', [true, true, true], 2, false],
  ] as const)(
    'lights the stages of a %s file by its status',
    async (status, expected, current, offMap) => {
      const host = await render({ status });

      expect(lit(host)).toEqual(expected);
      expect(currentAt(host)).toBe(current);
      expect(host.querySelector('.off-map') !== null).toBe(offMap);
    },
  );

  // @traces 116-FR-015
  it('names what more was asked for under the second stage', async () => {
    const host = await render({
      requestedItems: ['documents', 'photos'],
      status: 'more_requested',
    });

    expect(names(host)[1]).toBe('Cerute completări');
    expect(
      [...(stages(host)[1]?.querySelectorAll('.items li') ?? [])].map(text),
    ).toEqual(['Documentele', 'Fotografiile']);
  });

  // @traces 116-FR-015
  it('gives the reason and the note of a rejection under the second stage', async () => {
    const host = await render({
      reason: { code: 'rar', note: 'Autorizația a expirat în 2025.' },
      status: 'rejected',
    });

    expect(names(host)[1]).toBe('Respins');
    expect(text(stages(host)[1]?.querySelector('.reason'))).toBe(
      'Autorizația RAR',
    );
    expect(text(stages(host)[1]?.querySelector('.note'))).toBe(
      'Autorizația a expirat în 2025.',
    );
  });

  // @traces 116-FR-015
  it('reads the English texts of a request for more and a rejection', async () => {
    const more = await render(
      { requestedItems: ['address'], status: 'more_requested' },
      'en',
    );
    expect(names(more)[1]).toBe('More details requested');
    TestBed.resetTestingModule();

    const rejected = await render(
      { reason: { code: 'other', note: 'x' }, status: 'rejected' },
      'en',
    );
    expect(names(rejected)[1]).toBe('Rejected');
  });

  // @traces 116-FR-019
  it('tells each stage by its name, the colour only beside it', async () => {
    const host = await render({ status: 'in_review' });

    for (const li of stages(host)) {
      expect(text(li.querySelector('.name'))).not.toBe('');
      expect(li.querySelector('.dot')?.getAttribute('aria-hidden')).toBe(
        'true',
      );
    }
  });

  // @traces 116-FR-002
  it.each(['ro', 'en'] as const)(
    'never says publish, in %s, whatever the status',
    async (language) => {
      for (const status of [
        'draft',
        'submitted',
        'in_review',
        'more_requested',
        'rejected',
        'approved',
      ] as const) {
        const host = await render(
          {
            reason: { code: 'documents', note: 'n' },
            requestedItems: ['documents'],
            status,
          },
          language,
        );
        expect(text(host).toLowerCase()).not.toMatch(/publică|publish/);
        TestBed.resetTestingModule();
      }
    },
  );

  // @traces 116-FR-019
  it('stacks the stages on a phone and sets them in a row from a tablet', () => {
    const css = readFileSync(
      join(__dirname, 'verification-stages.css'),
      'utf8',
    );
    const wide = css.indexOf('@media (min-width: 768px)');

    expect(wide).toBeGreaterThan(-1);
    expect(css.slice(0, wide)).not.toMatch(
      /\.stages \{[^}]*grid-template-columns/,
    );
    expect(css.slice(wide)).toMatch(
      /\.stages \{[^}]*grid-template-columns: repeat\(3, minmax\(0, 1fr\)\);/,
    );
  });
});
