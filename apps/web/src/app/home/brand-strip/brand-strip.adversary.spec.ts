import { signal } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import type { BrandDto } from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';
import { REDUCED_MOTION } from '@motor-fix/ui-cockpit';

import { BrandStrip } from './brand-strip';

const reduced = signal(false);
let fixture: ComponentFixture<BrandStrip>;

const brand = (name: string, i = 0): BrandDto => ({
  id: `id-${i}`,
  name,
  popularity: i + 1,
  slug: `slug-${i}`,
});

async function render(brands: BrandDto[]) {
  TestBed.configureTestingModule({
    providers: [{ provide: REDUCED_MOTION, useValue: reduced }],
  });
  const i18n = TestBed.inject(I18n);
  await i18n.enter('public');
  await i18n.use('ro');
  fixture = TestBed.createComponent(BrandStrip);
  fixture.componentRef.setInput('brands', brands);
  fixture.detectChanges();
  return fixture.nativeElement as HTMLElement;
}

const buttons = (root: HTMLElement) => [
  ...root.querySelectorAll<HTMLButtonElement>('button'),
];
const reachable = (root: HTMLElement) =>
  buttons(root).filter(
    (b) => b.tabIndex !== -1 && !b.closest('[aria-hidden="true"]'),
  );

beforeEach(() => {
  reduced.set(false);
});

// @traces 228-FR-007 228-FR-010
describe('the brand strip under hostile input', () => {
  it('renders no brand button for an empty list', async () => {
    const root = await render([]);

    expect(buttons(root)).toHaveLength(0);
  });

  it('shows one brand once to the keyboard and once more in the hidden copy', async () => {
    const root = await render([brand('Dacia')]);

    expect(reachable(root).map((b) => b.textContent?.trim())).toEqual([
      'Dacia',
    ]);
    expect(buttons(root)).toHaveLength(2);
  });

  it('holds sixteen brands as sixteen reachable controls and thirty-two buttons', async () => {
    const root = await render(
      Array.from({ length: 16 }, (_, i) => brand(`Marca ${i}`, i)),
    );

    expect(reachable(root)).toHaveLength(16);
    expect(buttons(root)).toHaveLength(32);
  });

  it('holds a thousand brands without losing the order', async () => {
    const many = Array.from({ length: 1000 }, (_, i) => brand(`M${i}`, i));
    const root = await render(many);

    const names = reachable(root).map((b) => b.textContent?.trim());
    expect(names).toHaveLength(1000);
    expect(names[0]).toBe('M0');
    expect(names[999]).toBe('M999');
  });

  it('writes a brand name containing markup as text, never as elements', async () => {
    const root = await render([
      brand('<img src=x onerror="window.pwned=1">', 0),
      brand('</button><script>window.pwned=1</script>', 1),
    ]);

    expect(root.querySelector('img')).toBeNull();
    expect(root.querySelector('script')).toBeNull();
    expect(reachable(root).map((b) => b.textContent?.trim())).toEqual([
      '<img src=x onerror="window.pwned=1">',
      '</button><script>window.pwned=1</script>',
    ]);
  });

  it('shows names as written: right-to-left, combining marks, emoji and padding spaces', async () => {
    const names = ['مرسيدس', 'Škoda', 'Ford 🚗', 'Ä'];
    const root = await render(names.map((n, i) => brand(n, i)));

    expect(reachable(root).map((b) => b.textContent?.trim())).toEqual(names);
  });

  it('keeps a button for a brand with an empty name, so the order does not shift', async () => {
    const root = await render([
      brand('Dacia', 0),
      brand('', 1),
      brand('BMW', 2),
    ]);

    expect(reachable(root)).toHaveLength(3);
  });

  it('emits the very brand object that was tapped, with its id and slug', async () => {
    const list = [brand('Dacia', 0), brand('BMW', 1)];
    const root = await render(list);
    const picked: BrandDto[] = [];
    fixture.componentInstance.pick.subscribe((b) => picked.push(b));

    reachable(root)[1].click();

    expect(picked).toEqual([list[1]]);
  });

  it('does not emit anything before a tap', async () => {
    await render([brand('Dacia')]);
    const picked: BrandDto[] = [];
    fixture.componentInstance.pick.subscribe((b) => picked.push(b));
    fixture.detectChanges();

    expect(picked).toEqual([]);
  });

  it('follows a new list: shrinking to empty removes every button', async () => {
    const root = await render([brand('Dacia', 0), brand('BMW', 1)]);

    fixture.componentRef.setInput('brands', []);
    fixture.detectChanges();

    expect(buttons(root)).toHaveLength(0);
  });

  it('keeps order when the list is replaced by the same brands reversed', async () => {
    const list = [brand('Dacia', 0), brand('BMW', 1), brand('Kia', 2)];
    const root = await render(list);

    fixture.componentRef.setInput('brands', [...list].reverse());
    fixture.detectChanges();

    expect(reachable(root).map((b) => b.textContent?.trim())).toEqual([
      'Kia',
      'BMW',
      'Dacia',
    ]);
  });
});
