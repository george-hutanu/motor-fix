import { TestBed } from '@angular/core/testing';
import { CarsService, type SoldCarDto } from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';

import { SoldCars } from './sold-cars';

const sold = (id: string, model: string): SoldCarDto => ({
  brandName: 'VW',
  id,
  model,
  saleDate: new Date().toISOString(),
  year: 2015,
});

async function render(cars: SoldCarDto[], language: 'ro' | 'en' = 'ro') {
  TestBed.configureTestingModule({
    providers: [{ provide: CarsService, useValue: {} }],
  });
  await TestBed.inject(I18n).enter('driver');
  if (language === 'en') await TestBed.inject(I18n).use('en');
  const fixture = TestBed.createComponent(SoldCars);
  fixture.componentRef.setInput('cars', cars);
  fixture.detectChanges();
  return { element: fixture.nativeElement as HTMLElement, fixture };
}

const names = (element: HTMLElement) =>
  [...element.querySelectorAll('mf-sold-car')].map(
    (card) => card.querySelector('p')?.textContent?.trim().split(' · ')[0],
  );

// @traces 1394-FR-003
describe('the sold cars section', () => {
  it('lists the sold cars under its title in the order they were answered', async () => {
    const { element } = await render([
      sold('sold-2', 'Polo'),
      sold('sold-1', 'Golf'),
    ]);

    expect(element.querySelector('h2')?.textContent?.trim()).toBe(
      'Mașini vândute',
    );
    expect(names(element)).toEqual(['VW Polo 2015', 'VW Golf 2015']);
  });

  it('is titled in English', async () => {
    const { element } = await render([sold('sold-1', 'Golf')], 'en');

    expect(element.querySelector('h2')?.textContent?.trim()).toBe('Sold cars');
  });

  it('renders nothing once no sold car is left', async () => {
    const { element } = await render([]);

    expect(element.querySelector('h2')).toBeNull();
    expect(element.textContent?.trim()).toBe('');
  });

  it('passes on that a sold car is gone', async () => {
    const { element, fixture } = await render([sold('sold-1', 'Golf')]);
    const gone = jest.fn();
    fixture.componentInstance.gone.subscribe(gone);

    const card = element.querySelector('mf-sold-car');
    expect(card).not.toBeNull();
    (
      fixture.debugElement.query((d) => d.name === 'mf-sold-car')
        .componentInstance as { gone: { emit(): void } }
    ).gone.emit();

    expect(gone).toHaveBeenCalledTimes(1);
  });
});
