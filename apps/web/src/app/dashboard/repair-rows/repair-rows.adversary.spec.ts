import { TestBed } from '@angular/core/testing';
import type { CarRepairDto } from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';

import { RepairRows } from './repair-rows';

const repair = (over: Partial<CarRepairDto> = {}): CarRepairDto => ({
  car: { brandName: 'VW', model: 'Golf' } as CarRepairDto['car'],
  correctedBy: null,
  costBani: null,
  doneOn: '2026-06-12',
  fromPreviousOwner: false,
  garageId: null,
  garageName: 'Service Ionescu',
  id: 'repair-1',
  mechanicName: null,
  odometerKm: null,
  review: null,
  source: 'motorfix',
  what: 'Schimb ulei',
  ...over,
});

async function render(rows: CarRepairDto[]) {
  TestBed.configureTestingModule({});
  await TestBed.inject(I18n).enter('driver');
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
describe('the repair rows under odd rows', () => {
  it('renders an empty list for no rows', async () => {
    const element = await render([]);

    expect(items(element)).toHaveLength(0);
  });

  it('renders a thousand rows', async () => {
    const rows = Array.from({ length: 1000 }, (_, i) =>
      repair({ id: `r-${i}`, what: `Lucrare ${i}` }),
    );
    const element = await render(rows);

    expect(items(element)).toHaveLength(1000);
    expect(said(items(element)[999])).toContain('Lucrare 999');
  });

  it('shows markup in what was done as plain text', async () => {
    const element = await render([
      repair({ what: '<b>bold</b><script>x</script>' }),
    ]);

    expect(element.querySelector('b, script')).toBeNull();
    expect(said(element)).toContain('<b>bold</b><script>x</script>');
  });

  it('leaves out the garage and its dot when the garage has no name', async () => {
    const element = await render([repair({ garageName: '' })]);

    expect(said(items(element)[0])).toContain('12 iun. 2026');
    expect(said(items(element)[0])).not.toContain('·');
  });

  it('shows the dash for a day that does not exist', async () => {
    const element = await render([repair({ doneOn: '2026-02-30' })]);

    expect(said(items(element)[0])).toContain('—');
    expect(said(items(element)[0])).not.toContain('2026');
  });

  it('shows the dash for a day that is not a date', async () => {
    const element = await render([repair({ doneOn: 'yesterday' })]);

    expect(said(items(element)[0])).toContain('—');
  });

  it('writes the unicode in a garage name as it is', async () => {
    const element = await render([repair({ garageName: 'Șoseaua ăîâ 🚗' })]);

    expect(said(items(element)[0])).toContain('Șoseaua ăîâ 🚗');
  });

  it('keeps a very long description in its row', async () => {
    const what = 'x'.repeat(50_000);
    const element = await render([repair({ what })]);

    expect(items(element)).toHaveLength(1);
    expect(items(element)[0].textContent).toContain(what);
  });

  it('labels only the previous owner when both flags would apply', async () => {
    const element = await render([
      repair({ fromPreviousOwner: true, source: 'logged' }),
    ]);

    expect(items(element)[0].querySelectorAll('.label')).toHaveLength(1);
  });

  it('lists two rows with the same id both', async () => {
    const element = await render([repair(), repair()]);

    expect(items(element)).toHaveLength(2);
  });
});
