import { TestBed } from '@angular/core/testing';
import type { ReportQueueItemDto } from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';

import { AdminReviewItem } from './admin-review-item';

const NOW = new Date('2026-10-30T10:00:00Z');

type Report = ReportQueueItemDto['report'];

const item = (
  report: Partial<Report> = {},
  extra: Partial<ReportQueueItemDto> = {},
): ReportQueueItemDto => ({
  facts: {
    account: { createdAt: '2026-10-28T08:00:00Z', deleted: false },
    garageReports: { earlier: 3, kept: 1 },
    identicalReviews: 0,
    job: {
      car: 'VW Golf',
      handedOverAt: '2026-10-20T12:00:00Z',
      kind: 'confirmed',
      work: 'Ambreiaj',
    },
  },
  garage: { id: 'garage-1', name: 'Atelier Test' },
  report: {
    createdAt: '2026-10-29T09:00:00Z',
    dueAt: '2026-10-31T09:00:00Z',
    id: 'report-1',
    overdue: false,
    reason: 'insults',
    source: 'garage',
    target: 'review',
    ...report,
  },
  review: {
    author: 'Andrei P.',
    id: 'review-1',
    postedAt: '2026-10-28T10:00:00Z',
    score: 1,
    source: 'job',
    text: 'Mi-au stricat mașina.',
  },
  ...extra,
});

const reply = (report: Partial<Report> = {}, editedAt: string | null = null) =>
  item(
    { source: 'author', target: 'reply', ...report },
    {
      reply: {
        editedAt,
        id: 'reply-1',
        postedAt: '2026-10-29T08:30:00Z',
        postedBy: 'Atelier Test',
        text: 'Clientul minte.',
      },
    },
  );

async function render(
  value: ReportQueueItemDto,
  { language = 'ro', now = NOW }: { language?: 'ro' | 'en'; now?: Date } = {},
) {
  TestBed.configureTestingModule({});
  const i18n = TestBed.inject(I18n);
  if (language === 'en') await i18n.use('en');
  await i18n.enter('admin');
  const fixture = TestBed.createComponent(AdminReviewItem);
  fixture.componentRef.setInput('item', value);
  fixture.componentRef.setInput('now', now);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  return { el: fixture.nativeElement as HTMLElement, fixture };
}

const text = (el: Element | null | undefined) =>
  el?.textContent?.replace(/\s+/g, ' ').trim();
const lamp = (el: HTMLElement) => text(el.querySelector('mf-lamp'));
const facts = (el: HTMLElement) =>
  [...el.querySelectorAll('.facts li')].map((li) => text(li));

afterEach(() => TestBed.resetTestingModule());

// @traces 1389-FR-003 1389-FR-004 1389-FR-005 1389-FR-007
describe('an item under hostile content', () => {
  const MARKUP = '<img src=x onerror=alert(1)><b>x</b>';

  it('renders the report text of reason other as characters, never as elements', async () => {
    const { el } = await render(item({ reason: 'other', text: MARKUP }));

    expect(el.querySelector('img')).toBeNull();
    expect(el.querySelector('b')).toBeNull();
    expect(lamp(el)).toBe(`Raportată de service: Altceva: ${MARKUP}`);
  });

  it.each([null, undefined, ''])(
    'reads the reason alone for reason other with report text %p',
    async (reportText) => {
      const { el } = await render(item({ reason: 'other', text: reportText }));

      expect(lamp(el)).toBe('Raportată de service: Altceva');
    },
  );

  it('does not add the report text after a reason that is not other', async () => {
    const { el } = await render(item({ reason: 'ads', text: 'secret note' }));

    expect(lamp(el)).toBe('Raportată de service: Reclamă');
  });

  it('draws no text block for an empty review text', async () => {
    const { el } = await render(
      item(
        {},
        {
          review: {
            ...(item().review as NonNullable<ReportQueueItemDto['review']>),
            text: '',
          },
        },
      ),
    );

    expect(el.querySelector('.text, blockquote, p')).toBeNull();
  });

  it('renders markup in the garage name and author as characters in the title and label', async () => {
    const { el } = await render(
      item({}, { garage: { id: 'g', name: MARKUP } }),
    );

    expect(el.querySelector('img')).toBeNull();
    expect(el.querySelector('article')?.getAttribute('aria-label')).toBe(
      `${MARKUP} · recenzie de 1,0`,
    );
  });

  it('renders markup in the reply text, its poster and the review author as characters', async () => {
    const base = reply();
    const { el } = await render({
      ...base,
      reply: {
        ...(base.reply as NonNullable<typeof base.reply>),
        postedBy: MARKUP,
        text: MARKUP,
      },
      review: {
        ...(base.review as NonNullable<typeof base.review>),
        author: MARKUP,
      },
    });

    expect(el.querySelector('img')).toBeNull();
    expect(el.querySelector('b')).toBeNull();
    expect(text(el)).toContain(MARKUP);
  });

  it('keeps unicode names intact in the title', async () => {
    const { el } = await render(
      item({}, { garage: { id: 'g', name: 'Șanț Ăăî 車 🚗' } }),
    );

    expect(el.querySelector('article')?.getAttribute('aria-label')).toBe(
      'Șanț Ăăî 車 🚗 · recenzie de 1,0',
    );
  });

  it.each([
    [5, '5,0', '5.0'],
    [4.5, '4,5', '4.5'],
    [0, '0,0', '0.0'],
    [1.25, '1,3', '1.3'],
  ])(
    'writes the score %p with one decimal in each language',
    async (score, ro, en) => {
      const base = item();
      const review = {
        ...(base.review as NonNullable<typeof base.review>),
        score,
      };
      expect(
        (await render({ ...base, review })).el
          .querySelector('article')
          ?.getAttribute('aria-label'),
      ).toBe(`Atelier Test · recenzie de ${ro}`);
      TestBed.resetTestingModule();
      expect(
        (await render({ ...base, review }, { language: 'en' })).el
          .querySelector('article')
          ?.getAttribute('aria-label'),
      ).toBe(`Atelier Test · ${en} review`);
    },
  );
});

// @traces 1389-FR-003
describe('the facts at their edges', () => {
  it('says the account is gone even when the read still carries a creation date', async () => {
    const base = item();
    const { el } = await render({
      ...base,
      facts: {
        ...base.facts,
        account: { createdAt: '2026-01-01T00:00:00Z', deleted: true },
      },
    });

    expect(facts(el).join('|')).toContain('Cont șters');
    expect(facts(el).join('|')).not.toContain('Cont creat');
  });

  it('says the account is gone in English', async () => {
    const base = item();
    const { el } = await render(
      { ...base, facts: { ...base.facts, account: { deleted: true } } },
      { language: 'en' },
    );

    expect(facts(el).join('|')).toContain('Account deleted');
  });

  it('omits the handover date when the read carries null', async () => {
    const base = item();
    const { el } = await render({
      ...base,
      facts: {
        ...base.facts,
        job: {
          car: 'VW Golf',
          handedOverAt: null,
          kind: 'confirmed',
          work: 'Ambreiaj',
        },
      },
    });

    expect(facts(el)[0]).toBe('Lucrare confirmată: Ambreiaj, VW Golf');
  });

  it('shows the identical-reviews count and the garage history as zero, not missing', async () => {
    const base = item();
    const { el } = await render({
      ...base,
      facts: {
        ...base.facts,
        garageReports: { earlier: 0, kept: 0 },
        identicalReviews: 0,
      },
    });

    expect(facts(el)).toContain('Recenzii identice de la același cont: 0');
    expect(facts(el)).toContain(
      'Recenzii raportate de service înainte: 0, păstrate 0',
    );
  });

  it('shows large counts whole', async () => {
    const base = item();
    const { el } = await render({
      ...base,
      facts: { ...base.facts, identicalReviews: 1234567 },
    });

    expect(facts(el).join('|')).toMatch(
      /Recenzii identice de la același cont: 1.?234.?567/,
    );
  });

  it('names the profile fact for a review written from the profile', async () => {
    const base = item();
    const { el } = await render({
      ...base,
      facts: { ...base.facts, job: { kind: 'none' } },
    });

    expect(facts(el)[0]).toBe(
      'Fără lucrare: scrisă din profil (Nu prin MotorFix)',
    );
  });
});

// @traces 1389-FR-005
describe('the overdue mark against the clock', () => {
  it('appears when the time on screen moves past the due time, with no other change', async () => {
    const { el, fixture } = await render(
      item({ dueAt: '2026-10-30T10:00:30Z' }),
    );
    expect(text(el)).not.toContain('Peste 48 de ore');

    fixture.componentRef.setInput('now', new Date('2026-10-30T10:01:00Z'));
    fixture.detectChanges();

    expect(text(el)).toContain('Peste 48 de ore');
  });

  it('shows no mark for an unreadable due time and does not throw', async () => {
    const { el } = await render(item({ dueAt: 'soon', overdue: false }));

    expect(text(el)).not.toContain('Peste 48 de ore');
  });

  it('shows the mark once only, however many times the clock ticks', async () => {
    const { el, fixture } = await render(
      item({ dueAt: '2026-10-29T00:00:00Z' }),
    );
    fixture.componentRef.setInput('now', new Date('2026-10-30T11:00:00Z'));
    fixture.detectChanges();

    expect(text(el)?.split('Peste 48 de ore').length).toBe(2);
  });
});

// @traces 1389-FR-004
describe('a reply item at its edges', () => {
  it('shows no reporting garage on an automatic report of a reply', async () => {
    const { el } = await render(reply({ source: 'automatic' }));

    expect(lamp(el)).toBe('Raportată automat: Insulte');
  });

  it('shows no edited mark for a reply that was never edited', async () => {
    const { el } = await render(reply({}, null));

    expect(text(el)).not.toContain('editat');
  });

  it('shows the reply title for a review whose author is unicode', async () => {
    const base = reply();
    const { el } = await render({
      ...base,
      review: {
        ...(base.review as NonNullable<typeof base.review>),
        author: 'Ștefan Ț.',
      },
    });

    expect(el.querySelector('article')?.getAttribute('aria-label')).toBe(
      'Atelier Test · răspuns la recenzia lui Ștefan Ț.',
    );
  });

  it('keeps the reply item to one article', async () => {
    const { el } = await render(reply());

    expect(el.querySelectorAll('article').length).toBe(1);
  });
});
