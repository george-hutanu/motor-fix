import { TestBed } from '@angular/core/testing';
import type { CarRepairDto } from '@motor-fix/data-access';
import { formatDay, I18n } from '@motor-fix/i18n';

import { RepairRows } from './repair-rows';

const repair = (over: Partial<CarRepairDto> = {}): CarRepairDto => ({
  car: { brandName: 'VW', model: 'Golf' } as CarRepairDto['car'],
  correctedBy: null,
  costBani: 120000,
  doneOn: '2026-06-12',
  fromPreviousOwner: false,
  garageId: 'garage-1',
  garageName: 'Service Ionescu',
  id: 'repair-1',
  mechanicName: null,
  odometerKm: 120500,
  review: null,
  source: 'motorfix',
  what: 'Schimb ulei',
  ...over,
});

async function render(rows: CarRepairDto[], language: 'ro' | 'en' = 'ro') {
  TestBed.configureTestingModule({});
  await TestBed.inject(I18n).enter('driver');
  if (language === 'en') await TestBed.inject(I18n).use('en');
  const fixture = TestBed.createComponent(RepairRows);
  fixture.componentRef.setInput('rows', rows);
  fixture.detectChanges();
  return fixture.nativeElement as HTMLElement;
}

const items = (element: HTMLElement) => [
  ...element.querySelectorAll<HTMLElement>('ul > li'),
];
const said = (element: HTMLElement) =>
  (element.textContent ?? '').replace(/\s+/g, ' ').trim();

// @traces 1394-FR-004
describe('the repair rows', () => {
  it('lists each repair as a list item with its day, what was done and the garage', async () => {
    const element = await render([
      repair(),
      repair({ doneOn: '2025-11-03', id: 'repair-2', what: 'Plăcuțe frână' }),
    ]);

    expect(items(element)).toHaveLength(2);
    expect(said(items(element)[0])).toContain('Schimb ulei');
    expect(said(items(element)[0])).toContain(formatDay('2026-06-12', 'ro'));
    expect(said(items(element)[0])).toContain('Service Ionescu');
    expect(said(items(element)[1])).toContain('Plăcuțe frână');
  });

  it('labels a repair that came from the previous owner as its last column', async () => {
    const element = await render([
      repair({ fromPreviousOwner: true, source: 'logged' }),
    ]);

    const last = items(element)[0].lastElementChild;
    expect(last?.textContent?.trim()).toBe('de la proprietarul anterior');
    expect(said(element)).not.toContain('Adăugată de tine');
  });

  it('marks the reader’s own logged repair as added by them', async () => {
    const element = await render([repair({ source: 'logged' })]);

    expect(items(element)[0].lastElementChild?.textContent?.trim()).toBe(
      'Adăugată de tine',
    );
  });

  it('labels nothing for a MotorFix repair of the reader’s own', async () => {
    const element = await render([repair()]);

    expect(said(element)).not.toContain('Adăugată de tine');
    expect(said(element)).not.toContain('de la proprietarul anterior');
  });

  it('renders no review link, invoice or action whatever the source', async () => {
    const element = await render([
      repair({
        review: { rating: 5 } as CarRepairDto['review'],
      }),
      repair({ fromPreviousOwner: true, id: 'repair-2', source: 'motorfix' }),
      repair({ id: 'repair-3', source: 'logged' }),
    ]);

    expect(element.querySelectorAll('a, button, input')).toHaveLength(0);
    expect(said(element)).not.toMatch(/factur|invoice|recenzi|review/i);
  });

  it('reads in English', async () => {
    const element = await render(
      [
        repair({ fromPreviousOwner: true }),
        repair({ id: 'repair-2', source: 'logged' }),
      ],
      'en',
    );

    expect(said(items(element)[0])).toContain(formatDay('2026-06-12', 'en'));
    expect(items(element)[0].lastElementChild?.textContent?.trim()).toBe(
      'from the previous owner',
    );
    expect(items(element)[1].lastElementChild?.textContent?.trim()).toBe(
      'Added by you',
    );
  });
});
