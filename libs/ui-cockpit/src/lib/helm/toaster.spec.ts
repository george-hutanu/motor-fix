import { ChangeDetectionStrategy, Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import axe from 'axe-core';

import { HlmToaster, toast } from './toaster';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [HlmToaster],
  template: `<main><h1>Panou</h1></main><hlm-toaster />`,
})
class Host {}

async function settle(fixture: {
  detectChanges(): void;
  whenStable(): Promise<unknown>;
}) {
  fixture.detectChanges();
  await fixture.whenStable();
  await new Promise((r) => setTimeout(r, 0));
  fixture.detectChanges();
  await fixture.whenStable();
}

async function shown(...titles: Array<[string, boolean?]>) {
  const fixture = TestBed.createComponent(Host);
  await settle(fixture);
  for (const [title, important] of titles) {
    toast(title, { important });
    await settle(fixture);
  }
  const host = (fixture.nativeElement as HTMLElement).querySelector(
    'hlm-toaster',
  ) as HTMLElement;
  return { fixture, host };
}

const violations = async (host: HTMLElement) =>
  (
    await axe.run(host, {
      resultTypes: ['violations'],
      // jsdom lays nothing out, so contrast cannot be measured here.
      rules: { 'color-contrast': { enabled: false } },
    })
  ).violations.map((v) => `${v.id} (${v.impact})`);

afterEach(() => {
  toast.dismiss();
  TestBed.resetTestingModule();
});

describe('the toast stack', () => {
  it('passes axe with one toast shown', async () => {
    const { host } = await shown(['Salvat']);

    expect(host.querySelectorAll('[data-sonner-toast]')).toHaveLength(1);
    expect(await violations(host)).toEqual([]);
  });

  it('passes axe with a second toast added while the first shows', async () => {
    const { host } = await shown(['Salvat'], ['Am trimis un link nou', true]);

    expect(host.querySelectorAll('[data-sonner-toast]')).toHaveLength(2);
    expect(await violations(host)).toEqual([]);
  });

  it('is a list whose items are the toasts', async () => {
    const { host } = await shown(['Salvat'], ['Trimis']);

    const list = host.querySelector('ol[data-sonner-toaster]') as HTMLElement;
    expect(list.getAttribute('role')).toBe('list');
    const wrappers = [...list.children];
    expect(wrappers).toHaveLength(2);
    for (const wrapper of wrappers) {
      expect(wrapper.getAttribute('role')).toBe('none');
      expect(wrapper.querySelector('li[data-sonner-toast]')).not.toBeNull();
    }
  });

  it('keeps every toast a live region that holds its text', async () => {
    const { host } = await shown(['Salvat'], ['Urgent', true]);

    const items = [
      ...host.querySelectorAll<HTMLElement>('li[data-sonner-toast]'),
    ];
    const byText = (text: string) =>
      items.find((li) => li.textContent?.includes(text)) as HTMLElement;
    for (const li of items) {
      expect(li.hasAttribute('role')).toBe(false);
      expect(li.getAttribute('aria-atomic')).toBe('true');
    }
    expect(byText('Salvat').getAttribute('aria-live')).toBe('polite');
    expect(byText('Urgent').getAttribute('aria-live')).toBe('assertive');
  });

  it('passes axe for a toast with an action button', async () => {
    const { host } = await shown();
    toast('Șters', { action: { label: 'Anulează', onClick: () => undefined } });
    await new Promise((r) => setTimeout(r, 0));

    const li = host.querySelector('li[data-sonner-toast]') as HTMLElement;
    expect(li.querySelector('button')?.textContent).toContain('Anulează');
    expect(li.hasAttribute('role')).toBe(false);
    expect(await violations(host)).toEqual([]);
  });

  it('keeps the roles when a toast is dismissed and another added', async () => {
    const { fixture, host } = await shown();
    const first = toast('Unu');
    toast('Doi');
    await settle(fixture);
    toast.dismiss(first);
    await new Promise((r) => setTimeout(r, 500));
    toast('Trei', { important: true });
    await settle(fixture);

    const list = host.querySelector('ol[data-sonner-toaster]') as HTMLElement;
    expect(list.getAttribute('role')).toBe('list');
    for (const wrapper of list.children)
      expect(wrapper.getAttribute('role')).toBe('none');
    const trei = [...host.querySelectorAll('li[data-sonner-toast]')].find(
      (li) => li.textContent?.includes('Trei'),
    );
    expect(trei?.getAttribute('aria-live')).toBe('assertive');
    expect(await violations(host)).toEqual([]);
  });

  it('stops watching the stack once the toaster is gone', async () => {
    const { fixture, host } = await shown(['Salvat']);
    fixture.destroy();

    const orphan = document.createElement('ol');
    orphan.setAttribute('data-sonner-toaster', '');
    host.append(orphan);
    await new Promise((r) => setTimeout(r, 0));

    expect(orphan.hasAttribute('role')).toBe(false);
  });
});
