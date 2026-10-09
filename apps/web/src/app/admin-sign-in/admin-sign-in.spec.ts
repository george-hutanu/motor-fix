import { Component, PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { AdminSignIn } from './admin-sign-in';
import { SignInDialog } from '../sign-in/sign-in-dialog';

@Component({ selector: 'mf-home', template: '<h1>Home</h1>' })
class HomeStub {}

function render(platform = 'browser') {
  const start = jest.fn(async () => undefined);
  TestBed.configureTestingModule({
    providers: [
      { provide: SignInDialog, useValue: { start } },
      { provide: PLATFORM_ID, useValue: platform },
    ],
  });
  TestBed.overrideComponent(AdminSignIn, { set: { imports: [HomeStub] } });
  const fixture = TestBed.createComponent(AdminSignIn);
  fixture.detectChanges();
  return { element: fixture.nativeElement as HTMLElement, start };
}

describe('AdminSignIn', () => {
  it('shows the home page under the sign-in dialog', () => {
    const { element, start } = render();

    expect(element.querySelector('mf-home')).not.toBeNull();
    expect(start).toHaveBeenCalledTimes(1);
  });

  // @traces 261-FR-012
  it('asks for the dialog over the maintenance page too', () => {
    const { start } = render();

    expect(start).toHaveBeenCalledWith({ overMaintenance: true });
  });

  it('opens no dialog while the page is rendered on the server', () => {
    const { element, start } = render('server');

    expect(element.querySelector('mf-home')).not.toBeNull();
    expect(start).not.toHaveBeenCalled();
  });
});
