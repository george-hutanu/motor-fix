import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';

import { App } from './app';
import { PlatformStatus } from './maintenance/platform-status';

@Component({
  selector: 'mf-typing',
  template: '<label>Note <input name="note" /></label>',
})
class Typing {}

async function render() {
  const maintenance = signal(false);
  const isAdmin = signal(false);
  const showPage = signal(false);
  TestBed.configureTestingModule({
    providers: [
      provideRouter([{ component: Typing, path: 'typing' }]),
      {
        provide: PlatformStatus,
        useValue: { isAdmin, maintenance, showPage },
      },
    ],
  });
  const fixture = TestBed.createComponent(App);
  await TestBed.inject(Router).navigateByUrl('/typing');
  fixture.detectChanges();
  await fixture.whenStable();
  const element = fixture.nativeElement as HTMLElement;
  const set = async (state: { maintenance: boolean; isAdmin: boolean }) => {
    maintenance.set(state.maintenance);
    isAdmin.set(state.isAdmin);
    showPage.set(state.maintenance && !state.isAdmin);
    fixture.detectChanges();
    await fixture.whenStable();
  };
  return { element, set };
}

const screen = (element: HTMLElement) =>
  element.querySelector('mf-typing')?.parentElement as HTMLElement;

describe('App', () => {
  it('shows the routed screen and no maintenance page while maintenance is off', async () => {
    const { element } = await render();

    expect(element.querySelector('mf-maintenance-page')).toBeNull();
    expect(element.querySelector('mf-maintenance-banner')).toBeNull();
    expect(screen(element).hidden).toBe(false);
    expect(screen(element).hasAttribute('inert')).toBe(false);
  });

  it('puts the maintenance page over a kept, hidden and inert screen', async () => {
    const { element, set } = await render();

    await set({ isAdmin: false, maintenance: true });

    expect(element.querySelector('mf-maintenance-page')).not.toBeNull();
    expect(element.querySelector('mf-typing')).not.toBeNull();
    expect(screen(element).hidden).toBe(true);
    expect(screen(element).hasAttribute('inert')).toBe(true);
  });

  it('gives the screen back as it was, typed text and all, when maintenance ends', async () => {
    const { element, set } = await render();
    const input = element.querySelector('input') as HTMLInputElement;
    input.value = 'Schimb de ulei';

    await set({ isAdmin: false, maintenance: true });
    await set({ isAdmin: false, maintenance: false });

    expect(element.querySelector('mf-maintenance-page')).toBeNull();
    expect(element.querySelector('input')).toBe(input);
    expect(input.value).toBe('Schimb de ulei');
    expect(screen(element).hidden).toBe(false);
    expect(screen(element).hasAttribute('inert')).toBe(false);
  });

  it('shows an admin the screen with the maintenance banner', async () => {
    const { element, set } = await render();

    await set({ isAdmin: true, maintenance: true });

    expect(element.querySelector('mf-maintenance-page')).toBeNull();
    expect(element.querySelector('mf-maintenance-banner')).not.toBeNull();
    expect(screen(element).hidden).toBe(false);
  });

  it('shows an admin no banner while maintenance is off', async () => {
    const { element, set } = await render();

    await set({ isAdmin: true, maintenance: false });

    expect(element.querySelector('mf-maintenance-banner')).toBeNull();
  });
});
