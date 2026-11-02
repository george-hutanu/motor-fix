import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { CarsService, type SoldCarDto } from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';

import { SoldCars } from './sold-cars';

const sold = (id: string, model = id): SoldCarDto => ({
  brandName: 'VW',
  id,
  model,
  saleDate: '2026-10-30',
  year: 2015,
});

async function render(cars: SoldCarDto[], history?: jest.Mock) {
  TestBed.configureTestingModule({
    providers: [
      {
        provide: CarsService,
        useValue: { carHistoryControllerSoldRepairs: history ?? jest.fn() },
      },
    ],
  });
  await TestBed.inject(I18n).enter('driver');
  const fixture = TestBed.createComponent(SoldCars);
  fixture.componentRef.setInput('cars', cars);
  fixture.detectChanges();
  return { element: fixture.nativeElement as HTMLElement, fixture };
}

// @traces 1394-FR-003
describe('the sold cars under odd lists', () => {
  it('renders no section for no cars', async () => {
    const { element } = await render([]);

    expect(element.querySelector('section, h2')).toBeNull();
  });

  it('renders one card for one car', async () => {
    const { element } = await render([sold('a')]);

    expect(element.querySelectorAll('mf-sold-car')).toHaveLength(1);
  });

  it('renders five hundred cars under one title', async () => {
    const { element } = await render(
      Array.from({ length: 500 }, (_, i) => sold(`c-${i}`)),
    );

    expect(element.querySelectorAll('mf-sold-car')).toHaveLength(500);
    expect(element.querySelectorAll('h2')).toHaveLength(1);
  });

  it('removes the section once the list is emptied after being shown', async () => {
    const { element, fixture } = await render([sold('a')]);

    fixture.componentRef.setInput('cars', []);
    fixture.detectChanges();

    expect(element.querySelector('section')).toBeNull();
  });

  it('tells once when the car whose history was opened is gone', async () => {
    const history = jest.fn(async () => {
      throw new HttpErrorResponse({ status: 404 });
    });
    const { element, fixture } = await render([sold('a'), sold('b')], history);
    const gone = jest.fn();
    fixture.componentInstance.gone.subscribe(gone);

    element.querySelector<HTMLButtonElement>('button[aria-expanded]')?.click();
    for (let i = 0; i < 4; i++) {
      fixture.detectChanges();
      await fixture.whenStable();
    }

    expect(history).toHaveBeenCalledTimes(1);
    expect(gone).toHaveBeenCalledTimes(1);
  });

  it('keeps two cars with the same id both on the page', async () => {
    const { element } = await render([sold('a', 'Golf'), sold('a', 'Polo')]);

    expect(element.querySelectorAll('mf-sold-car')).toHaveLength(2);
  });
});
