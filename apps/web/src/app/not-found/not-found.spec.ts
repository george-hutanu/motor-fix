import { RESPONSE_INIT } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { NotFound } from './not-found';

function render() {
  const fixture = TestBed.createComponent(NotFound);
  fixture.detectChanges();
  return fixture.nativeElement as HTMLElement;
}

describe('NotFound', () => {
  beforeEach(() =>
    TestBed.configureTestingModule({ providers: [provideRouter([])] }),
  );

  it('says the page does not exist and links to Home', () => {
    const element = render();

    expect(element.querySelector('h1')?.textContent).toContain(
      'Pagina nu există',
    );
    expect(element.querySelector('a')?.getAttribute('href')).toBe('/');
  });

  it('puts its content in the main landmark', () => {
    const main = render().querySelector('main');

    expect(main?.querySelector('h1')).not.toBeNull();
    expect(main?.querySelector('a')).not.toBeNull();
  });

  it('answers 404 when rendered on the server', () => {
    const init: ResponseInit = {};
    TestBed.configureTestingModule({
      providers: [{ provide: RESPONSE_INIT, useValue: init }],
    });

    render();

    expect(init.status).toBe(404);
  });

  it('leaves the 503 of the maintenance page rendered before it', () => {
    const init: ResponseInit = { status: 503 };
    TestBed.configureTestingModule({
      providers: [{ provide: RESPONSE_INIT, useValue: init }],
    });

    render();

    expect(init.status).toBe(503);
  });
});
