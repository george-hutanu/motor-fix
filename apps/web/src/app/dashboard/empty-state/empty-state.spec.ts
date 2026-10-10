import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { I18n } from '@motor-fix/i18n';
import { HlmButton } from '@motor-fix/ui-cockpit';

import { type EmptyIcon, EmptyState } from './empty-state';

@Component({
  imports: [EmptyState, HlmButton],
  template: `
    <mf-empty-state [icon]="icon()" [text]="text()">
      @if (action()) {
        <button hlmBtn type="button">Adaugă o mașină</button>
      }
    </mf-empty-state>
  `,
})
class Host {
  readonly icon = signal<EmptyIcon>('car');
  readonly text = signal('driver.empty.cars');
  readonly action = signal(true);
}

async function render(
  over: Partial<{ icon: EmptyIcon; text: string; action: boolean }> = {},
  language: 'ro' | 'en' = 'ro',
) {
  await TestBed.inject(I18n).enter('driver');
  if (language === 'en') await TestBed.inject(I18n).use('en');
  const fixture = TestBed.createComponent(Host);
  if (over.icon) fixture.componentInstance.icon.set(over.icon);
  if (over.text) fixture.componentInstance.text.set(over.text);
  if (over.action === false) fixture.componentInstance.action.set(false);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  return fixture.nativeElement.querySelector('mf-empty-state') as HTMLElement;
}

const text = (element: Element) =>
  (element.textContent ?? '').replace(/\s+/g, ' ').trim();

afterEach(() => TestBed.resetTestingModule());

// @traces 030-FR-005
describe('the empty state', () => {
  it('shows its translated sentences and the one action it was given', async () => {
    const element = await render();

    expect(text(element.querySelector('p')!)).toBe(
      'Adaugă prima ta mașină. O folosim ca să‑ți arătăm service‑urile potrivite și să‑ți amintim de ITP.',
    );
    expect(element.querySelectorAll('button')).toHaveLength(1);
    expect(
      element
        .querySelector('p')!
        .compareDocumentPosition(element.querySelector('button')!) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('says its text in English for an English reader', async () => {
    const element = await render({}, 'en');

    expect(text(element.querySelector('p')!)).toBe(
      'Add your first car. We use it to show you the right garages and to remind you about the ITP.',
    );
  });

  it('stands with no action at all', async () => {
    const element = await render({
      action: false,
      icon: 'star',
      text: 'driver.empty.reviews',
    });

    expect(element.querySelector('button, a')).toBeNull();
    expect(text(element)).toBe(
      'Nicio recenzie încă. După o reparație prin MotorFix îți cerem părerea.',
    );
  });

  it.each<EmptyIcon>([
    'car',
    'search',
    'quote',
    'wrench',
    'bookmark',
    'star',
    'inbox',
  ])('draws the %s icon inline', async (icon) => {
    const element = await render({ icon });
    const svg = element.querySelector('svg');

    expect(svg).not.toBeNull();
    expect(
      svg!.querySelector('path, circle, rect, polyline, line'),
    ).not.toBeNull();
    expect(svg!.getAttribute('data-icon')).toBe(icon);
  });
});

// @traces 030-FR-013
describe('the empty state for a reader without a pointer', () => {
  it('hides its icon from assistive technology and gives it no text', async () => {
    const svg = (await render()).querySelector('svg')!;

    expect(svg.getAttribute('aria-hidden')).toBe('true');
    expect(svg.getAttribute('focusable')).toBe('false');
    expect(text(svg)).toBe('');
    expect(svg.querySelector('title')).toBeNull();
  });

  it('leaves its action a native button in the tab order', async () => {
    const button = (await render()).querySelector('button')!;

    expect(button.tabIndex).toBe(0);
    expect(button.hasAttribute('hlmbtn')).toBe(true);
  });
});
