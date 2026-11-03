import { TestBed } from '@angular/core/testing';
import type { ReportQueueItemDto } from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';
import { Overlays } from '@motor-fix/overlays';

import { AdminReviewItem } from './admin-review-item';
import type { RemoveReviewResult } from '../remove-review-dialog/remove-review-dialog';

const NOW = new Date('2026-10-30T10:00:00Z');

const item = (target: 'review' | 'reply' = 'review'): ReportQueueItemDto => ({
  facts: {
    account: { createdAt: '2026-10-28T08:00:00Z', deleted: false },
    garageReports: { earlier: 0, kept: 0 },
    identicalReviews: 0,
    job: { kind: 'none' },
  },
  garage: { id: 'garage-1', name: 'Atelier Test' },
  report: {
    createdAt: '2026-10-29T09:00:00Z',
    dueAt: '2026-10-31T09:00:00Z',
    id: 'report-1',
    overdue: false,
    reason: 'insults',
    source: 'garage',
    target,
  },
  review: {
    author: 'Andrei P.',
    id: 'review-1',
    postedAt: '2026-10-28T10:00:00Z',
    score: 1,
    source: 'job',
    text: 'Mi-au stricat mașina.',
  },
  ...(target === 'reply'
    ? {
        reply: {
          editedAt: null,
          id: 'reply-1',
          postedAt: '2026-10-29T08:30:00Z',
          postedBy: 'Atelier Test',
          text: 'Clientul minte.',
        },
      }
    : {}),
});

const flush = async () => {
  for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r));
};

async function render(
  value: ReportQueueItemDto,
  open: (...args: unknown[]) => Promise<unknown> = async () => 'cancelled',
  language: 'ro' | 'en' = 'ro',
) {
  TestBed.configureTestingModule({
    providers: [{ provide: Overlays, useValue: { open } }],
  });
  const i18n = TestBed.inject(I18n);
  if (language === 'en') await i18n.use('en');
  await i18n.enter('admin');
  const fixture = TestBed.createComponent(AdminReviewItem);
  fixture.componentRef.setInput('item', value);
  fixture.componentRef.setInput('now', NOW);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  return { el: fixture.nativeElement as HTMLElement, fixture };
}

const text = (el: Element | null | undefined) =>
  el?.textContent?.replace(/\s+/g, ' ').trim();

async function setOutcome(
  fixture: Awaited<ReturnType<typeof render>>['fixture'],
  outcome: RemoveReviewResult | undefined,
) {
  fixture.componentRef.setInput('outcome', outcome);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
}

afterEach(() => TestBed.resetTestingModule());

// @traces 1423-FR-004 1423-FR-005
describe('the status line of a decided item', () => {
  it('brings the actions back when the outcome is cleared', async () => {
    const { el, fixture } = await render(item());
    await setOutcome(fixture, { outcome: 'removed' });
    expect(el.querySelector('button.remove')).toBeNull();

    await setOutcome(fixture, undefined);

    expect(el.querySelector('button.remove')).not.toBeNull();
    expect(el.querySelector('.decided')).toBeNull();
  });

  it('says already decided with no trailing "de" when the name is an empty string', async () => {
    const { el, fixture } = await render(item());
    await setOutcome(fixture, { by: '', outcome: 'already_decided' });

    expect(text(el.querySelector('.decided'))).toBe('Deja decisă');
  });

  it('shows the deciding admin as characters, never as elements', async () => {
    const { el, fixture } = await render(item());
    await setOutcome(fixture, {
      by: '<img src=x onerror=alert(1)> Ștefan',
      outcome: 'already_decided',
    });

    expect(el.querySelector('.decided img')).toBeNull();
    expect(text(el.querySelector('.decided'))).toBe(
      'Deja decisă de <img src=x onerror=alert(1)> Ștefan',
    );
  });

  it('names the deciding admin in English on a reply', async () => {
    const { el, fixture } = await render(item('reply'), undefined, 'en');
    await setOutcome(fixture, { by: 'Ana', outcome: 'already_decided' });

    expect(text(el.querySelector('.decided'))).toBe('Already decided by Ana');
    expect(el.querySelectorAll('button')).toHaveLength(0);
  });

  it('says a reply is no longer pending with no status role', async () => {
    const { el, fixture } = await render(item('reply'));
    await setOutcome(fixture, { outcome: 'gone' });

    expect(text(el.querySelector('.decided'))).toBe(
      'Raportul nu mai e în așteptare',
    );
    expect(el.querySelector('[role="status"]')).toBeNull();
  });

  it('keeps the title and the facts when decided', async () => {
    const { el, fixture } = await render(item());
    await setOutcome(fixture, { outcome: 'removed' });

    expect(el.querySelector('article')?.getAttribute('aria-label')).toBe(
      'Atelier Test · recenzie de 1,0',
    );
    expect(el.querySelectorAll('.facts li').length).toBeGreaterThan(0);
  });

  it('has exactly one status element for a removed reply', async () => {
    const { el, fixture } = await render(item('reply'));
    await setOutcome(fixture, { outcome: 'removed' });

    expect(el.querySelectorAll('[role="status"]')).toHaveLength(1);
  });
});

// @traces 1423-FR-001 1423-FR-002 1423-FR-003
describe('pressing remove on the item', () => {
  it('opens one confirmation and emits once when the button is pressed twice at once', async () => {
    let release: (v: unknown) => void = () => undefined;
    const open = vi.fn(() => new Promise((r) => (release = r)));
    const { el, fixture } = await render(item(), open);
    const emitted: unknown[] = [];
    fixture.componentInstance.decided.subscribe((v) => emitted.push(v));
    const remove = el.querySelector<HTMLButtonElement>('button.remove');

    remove?.click();
    remove?.click();
    // The confirmation loads on the first press; answer once it is open.
    await flush();
    remove?.click();
    release({ outcome: 'removed' });
    await flush();

    expect(open).toHaveBeenCalledTimes(1);
    expect(emitted).toEqual([{ outcome: 'removed' }]);
  });

  it.each<RemoveReviewResult>([
    { by: 'Ana', outcome: 'already_decided' },
    { outcome: 'already_decided' },
    { outcome: 'gone' },
  ])('emits the dialog answer %j unchanged', async (answer) => {
    const { el, fixture } = await render(item(), async () => answer);
    const emitted: unknown[] = [];
    fixture.componentInstance.decided.subscribe((v) => emitted.push(v));

    el.querySelector<HTMLButtonElement>('button.remove')?.click();
    await flush();

    expect(emitted).toEqual([answer]);
  });

  it('can be pressed again after a cancelled dialog', async () => {
    const open = vi.fn(async () => 'cancelled');
    const { el } = await render(item(), open);
    const remove = el.querySelector<HTMLButtonElement>('button.remove');

    remove?.click();
    await flush();
    remove?.click();
    await flush();

    expect(open).toHaveBeenCalledTimes(2);
  });

  it('keeps Keep inert and opens nothing from the reply item', async () => {
    const open = vi.fn(async () => 'cancelled');
    const { el } = await render(item('reply'), open);

    el.querySelector<HTMLButtonElement>('button.keep')?.click();
    await flush();

    expect(open).not.toHaveBeenCalled();
    expect(el.querySelector('button.keep')?.getAttribute('aria-disabled')).toBe(
      'true',
    );
  });

  it('gives the remove button of a review and of a reply their own labels', async () => {
    const review = await render(item());
    expect(text(review.el.querySelector('button.remove'))).toBe(
      'Șterge recenzia',
    );
    TestBed.resetTestingModule();

    const reply = await render(item('reply'), undefined, 'en');
    expect(text(reply.el.querySelector('button.remove'))).toBe(
      'Remove the reply',
    );
  });
});
