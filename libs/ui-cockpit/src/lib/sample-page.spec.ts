import { TestBed } from '@angular/core/testing';

import { provideCockpitTheme } from './provide-cockpit-theme';
import { CockpitSamplePage } from './sample-page';
import { SAMPLE_TEXT } from './sample-text';

function render() {
  TestBed.configureTestingModule({ providers: [provideCockpitTheme()] });
  const fixture = TestBed.createComponent(CockpitSamplePage);
  fixture.detectChanges();
  return fixture.nativeElement as HTMLElement;
}

const buttonNamed = (page: HTMLElement, name: string) =>
  [...page.querySelectorAll('button')].find(
    (b) => b.textContent?.trim() === name,
  );

describe('CockpitSamplePage', () => {
  it('shows exactly one main (amber) action next to a secondary one', () => {
    const page = render();
    const primary = [
      ...page.querySelectorAll('button.spartan-button-variant-default'),
    ];

    expect(primary.map((b) => b.textContent?.trim())).toEqual([
      SAMPLE_TEXT.primary,
    ]);
    expect(buttonNamed(page, SAMPLE_TEXT.secondary)).toBeDefined();
  });

  it('holds a labelled text input and a toggle switch', () => {
    const page = render();
    const input = page.querySelector<HTMLInputElement>('input.spartan-input');
    const label = page.querySelector(`label[for="${input?.id}"]`);

    expect(input).not.toBeNull();
    expect(label?.textContent?.trim()).toBe(SAMPLE_TEXT.inputLabel);
    expect(page.querySelector('button[role="switch"]')).not.toBeNull();
  });

  it('holds a table, tabs with one selected, and a panel', () => {
    const page = render();

    expect(page.querySelector('table.spartan-table')).not.toBeNull();
    expect(
      page.querySelectorAll('[role="tab"][aria-selected="true"]'),
    ).toHaveLength(1);
    expect(page.querySelector('mf-panel section.mf-panel')).not.toBeNull();
  });

  it('shows the Romanian sample in both typefaces', () => {
    const page = render();

    expect(SAMPLE_TEXT.romanian).toMatch(/(?=.*ș)(?=.*ț)(?=.*ă)(?=.*â)(?=.*î)/);
    expect(page.querySelector('.mf-label')?.textContent).toContain(
      SAMPLE_TEXT.romanian,
    );
    expect(
      [...page.querySelectorAll('p')].some((p) =>
        p.textContent?.includes(SAMPLE_TEXT.romanian),
      ),
    ).toBe(true);
  });

  it('offers controls that open a dialog, a drawer, a toast and a popover', () => {
    const page = render();

    for (const name of [
      SAMPLE_TEXT.openDialog,
      SAMPLE_TEXT.openDrawer,
      SAMPLE_TEXT.showToast,
      SAMPLE_TEXT.openPopover,
    ]) {
      expect(buttonNamed(page, name)).toBeDefined();
    }
  });
});
