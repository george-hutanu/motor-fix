import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { GarageStaffReviewDto } from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';

import { GarageReviewRow } from './garage-review-row';
import { NOW, repliedReview } from '../garage-reviews.testing';

@Component({
  imports: [GarageReviewRow],
  template: `
    @for (r of reviews(); track r.id) {
      <article mf-garage-review-row [review]="r" [now]="now" [owner]="owner()" (reply)="pressed = pressed + 1"></article>
    }
  `,
})
class Host {
  readonly reviews = signal<GarageStaffReviewDto[]>([]);
  readonly owner = signal(true);
  readonly now = NOW;
  pressed = 0;
}

let host: Host;
let fixture: ReturnType<typeof TestBed.createComponent<Host>>;

async function render(
  reviews: GarageStaffReviewDto[],
  {
    owner = true,
    language = 'ro',
  }: { owner?: boolean; language?: 'ro' | 'en' } = {},
) {
  TestBed.configureTestingModule({});
  const i18n = TestBed.inject(I18n);
  await i18n.enter('garage');
  if (language === 'en') await i18n.use('en');
  fixture = TestBed.createComponent(Host);
  host = fixture.componentInstance;
  host.reviews.set(reviews);
  host.owner.set(owner);
  fixture.detectChanges();
  await fixture.whenStable();
  return [
    ...fixture.nativeElement.querySelectorAll('article'),
  ] as HTMLElement[];
}

async function change(update: () => void) {
  update();
  fixture.detectChanges();
  await fixture.whenStable();
  return [
    ...fixture.nativeElement.querySelectorAll('article'),
  ] as HTMLElement[];
}

const text = (element: Element | null | undefined) =>
  (element?.textContent ?? '').replace(/\s+/g, ' ').trim();
const cell = (row: HTMLElement, name: string) =>
  row.querySelector(`[data-${name}]`);
const button = (row: HTMLElement) =>
  row.querySelector<HTMLButtonElement>('button[data-reply-button]');

afterEach(() => TestBed.resetTestingModule());

// @traces 1387-FR-001
describe('the inert edit button of a reported reply', () => {
  const reported = (over: Partial<GarageStaffReviewDto> = {}) =>
    repliedReview(over, { status: 'reported' });

  it('stays a live element: not natively disabled, not taken out of the tab order', async () => {
    const [row] = await render([reported()]);
    const edit = button(row);

    expect(edit?.disabled).toBe(false);
    expect(edit?.hasAttribute('disabled')).toBe(false);
    expect(edit?.getAttribute('tabindex')).not.toBe('-1');
    expect(edit?.getAttribute('aria-disabled')).toBe('true');
    expect(text(edit)).toBe('Editează răspunsul');
  });

  it('describes itself by the author line and then by the reported mark of its own row', async () => {
    const [row] = await render([reported()]);
    const ids = button(row)?.getAttribute('aria-describedby')?.split(' ') ?? [];

    expect(ids).toHaveLength(2);
    expect(text(row.querySelector(`[id="${ids[0]}"]`))).toContain('Andrei M.');
    expect(text(row.querySelector(`[id="${ids[1]}"]`))).toBe(
      'Raportat · ascuns până decide un admin',
    );
  });

  it('gives two reported rows different mark ids', async () => {
    const rows = await render([
      reported({ id: 'r-1' }),
      reported({ id: 'r-2' }),
    ]);
    const [a, b] = rows.map(
      (r) => button(r)?.getAttribute('aria-describedby')?.split(' ')[1],
    );

    expect(a).not.toBe(b);
    expect(document.querySelectorAll(`[id="${a}"]`)).toHaveLength(1);
  });

  it('opens nothing on a burst of clicks, however they are dispatched', async () => {
    const [row] = await render([reported()]);
    const edit = button(row);

    edit?.click();
    edit?.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 2 }));
    edit?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    edit?.click();

    expect(host.pressed).toBe(0);
  });

  it('carries no aria-disabled and describes only the author line on a published reply', async () => {
    const [row] = await render([repliedReview()]);
    const edit = button(row);

    expect(edit?.hasAttribute('aria-disabled')).toBe(false);
    expect(edit?.getAttribute('aria-describedby')?.split(' ')).toHaveLength(1);
  });

  it('becomes pressable on the same row when the reply goes back to published', async () => {
    const [row] = await render([reported()]);
    button(row)?.click();
    expect(host.pressed).toBe(0);

    await change(() => host.reviews.set([repliedReview()]));
    button(row)?.click();

    expect(button(row)?.hasAttribute('aria-disabled')).toBe(false);
    expect(cell(row, 'reply-reported')).toBeNull();
    expect(host.pressed).toBe(1);
  });

  it('becomes inert on the same row when the reply is reported while the row is open', async () => {
    const [row] = await render([repliedReview()]);

    await change(() => host.reviews.set([reported()]));
    button(row)?.click();

    expect(button(row)?.getAttribute('aria-disabled')).toBe('true');
    expect(host.pressed).toBe(0);
  });

  it('shows a receptionist the reported mark and no button', async () => {
    const [row] = await render([reported()], { owner: false });

    expect(text(cell(row, 'reply-reported'))).toBe(
      'Raportat · ascuns până decide un admin',
    );
    expect(button(row)).toBeNull();
    expect(row.querySelector('.actions')).toBeNull();
  });

  it('says the reported mark in English and keeps the button label', async () => {
    const [row] = await render([reported()], { language: 'en' });

    expect(text(cell(row, 'reply-reported'))).toBe(
      'Reported · hidden until an admin decides',
    );
    expect(text(button(row))).toBe('Edit the reply');
  });

  it('keeps a reported reply under a reported review with no button and the mark', async () => {
    const [row] = await render([reported({ status: 'reported' })]);

    expect(button(row)).toBeNull();
    expect(text(cell(row, 'reply-reported'))).toBe(
      'Raportat · ascuns până decide un admin',
    );
  });

  it('shows no mark and no block for a removed reply, whatever the owner flag', async () => {
    const [row] = await render([
      repliedReview({ canReply: false }, { status: 'removed' as never }),
    ]);

    expect(row.querySelector('[data-reply]')).toBeNull();
    expect(button(row)).toBeNull();
  });
});
