import { TestBed } from '@angular/core/testing';
import { I18n } from '@motor-fix/i18n';

import { provideCockpitTheme } from './provide-cockpit-theme';
import { CockpitSamplePage } from './sample-page';

const text = (key: string) => TestBed.inject(I18n).t(`cockpit.${key}`);

async function render() {
  TestBed.configureTestingModule({ providers: [provideCockpitTheme()] });
  const fixture = TestBed.createComponent(CockpitSamplePage);
  await TestBed.inject(I18n).enter('cockpit');
  fixture.detectChanges();
  return fixture.nativeElement as HTMLElement;
}

const buttonNamed = (page: HTMLElement, name: string) =>
  [...page.querySelectorAll('button')].find(
    (b) => b.textContent?.trim() === name,
  );

describe('CockpitSamplePage', () => {
  it('shows exactly one main (amber) action next to a secondary one', async () => {
    const page = await render();
    const primary = [
      ...page.querySelectorAll('button.spartan-button-variant-default'),
    ];

    expect(primary.map((b) => b.textContent?.trim())).toEqual([
      text('primary'),
    ]);
    expect(buttonNamed(page, text('secondary'))).toBeDefined();
  });

  it('holds a labelled text input and a toggle switch', async () => {
    const page = await render();
    const input = page.querySelector<HTMLInputElement>('input.spartan-input');
    const label = page.querySelector(`label[for="${input?.id}"]`);

    expect(input).not.toBeNull();
    expect(label?.textContent?.trim()).toBe(text('inputLabel'));
    expect(page.querySelector('button[role="switch"]')).not.toBeNull();
  });

  it('holds a table, tabs with one selected, and a panel', async () => {
    const page = await render();

    expect(page.querySelector('table.spartan-table')).not.toBeNull();
    expect(
      page.querySelectorAll('[role="tab"][aria-selected="true"]'),
    ).toHaveLength(1);
    expect(page.querySelector('mf-panel section.mf-panel')).not.toBeNull();
  });

  it('shows the Romanian sample in both typefaces', async () => {
    const page = await render();

    expect(text('romanian')).toMatch(/(?=.*ș)(?=.*ț)(?=.*ă)(?=.*â)(?=.*î)/);
    expect(page.querySelector('.mf-label')?.textContent).toContain(
      text('romanian'),
    );
    expect(
      [...page.querySelectorAll('p')].some((p) =>
        p.textContent?.includes(text('romanian')),
      ),
    ).toBe(true);
  });

  it('offers controls that open a dialog, a drawer, a toast and a popover', async () => {
    const page = await render();

    for (const name of [
      text('openDialog'),
      text('openDrawer'),
      text('showToast'),
      text('openPopover'),
    ]) {
      expect(buttonNamed(page, name)).toBeDefined();
    }
  });

  const settle = async () => {
    for (let i = 0; i < 3; i++) {
      TestBed.tick();
      await new Promise((resolve) => setTimeout(resolve));
    }
  };
  const openTask = () =>
    document.querySelector<HTMLElement>('.cdk-overlay-pane [role="dialog"]');

  afterEach(() => {
    document.querySelector('.cdk-overlay-container')?.remove();
  });

  it.each([
    ['overlay.openDialog', 'mf-overlay-dialog'],
    ['overlay.openDrawer', 'mf-overlay-drawer'],
    ['overlay.openWide', 'mf-overlay-drawer-wide'],
  ])('opens the sample task from %s in its shape', async (key, shape) => {
    const page = await render();

    buttonNamed(page, text(key))?.click();
    await settle();

    const task = openTask();
    expect(task?.querySelector('mf-overlay-panel')?.classList).toContain(shape);
    const input = task?.querySelector<HTMLInputElement>('input');
    expect(task?.querySelector(`label[for="${input?.id}"]`)?.textContent).toBe(
      text('overlay.field'),
    );
    expect(
      buttonNamed(task as HTMLElement, text('overlay.again')),
    ).toBeDefined();
  });

  it('shows the result the sample task closes with', async () => {
    const page = await render();
    buttonNamed(page, text('overlay.openDialog'))?.click();
    await settle();

    buttonNamed(openTask() as HTMLElement, text('overlay.done'))?.click();
    await settle();
    TestBed.tick();

    expect(openTask()).toBeNull();
    expect(page.querySelector('.mf-overlay-result')?.textContent).toContain(
      text('overlay.results.saved'),
    );
  });
});
