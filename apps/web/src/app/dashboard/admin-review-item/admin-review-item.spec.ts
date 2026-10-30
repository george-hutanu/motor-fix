import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { REVIEW_REPORT_REASON_TEXTS } from '@motor-fix/contracts';
import type { ReportQueueItemDto } from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';

import { AdminReviewItem } from './admin-review-item';
import { spoken } from '../../spoken.testing';

// @traces 1389-FR-003 1389-FR-004 1389-FR-005 1389-FR-007 1389-FR-008 1389-FR-009

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
const buttons = (el: HTMLElement) => [
  ...el.querySelectorAll<HTMLButtonElement>('button'),
];

afterEach(() => TestBed.resetTestingModule());

describe('a reported review', () => {
  it('is an article named by its title, with the score in one decimal', async () => {
    const { el } = await render(item());

    const article = el.querySelector('article');
    expect(article?.getAttribute('aria-label')).toBe(
      'Atelier Test · recenzie de 1,0',
    );
    expect(text(el.querySelector('.title'))).toBe(
      'Atelier Test · recenzie de 1,0',
    );
  });

  it('writes the title in English with an English decimal', async () => {
    const { el } = await render(item(), { language: 'en' });

    expect(el.querySelector('article')?.getAttribute('aria-label')).toBe(
      'Atelier Test · 1.0 review',
    );
  });

  it.each([
    ['garage', 'Raportată de service: Insulte'],
    ['author', 'Raportat de autor: Insulte'],
    ['automatic', 'Raportată automat: Insulte'],
  ] as const)('shows a red lamp for a %s report', async (source, words) => {
    const { el } = await render(item({ source }));

    expect(el.querySelector('mf-lamp')?.getAttribute('data-state')).toBe('red');
    expect(lamp(el)).toBe(words);
  });

  it.each([
    ['garage', 'Reported by the garage: Advertising'],
    ['author', 'Reported by the author: Advertising'],
    ['automatic', 'Flagged automatically: Advertising'],
  ] as const)('words a %s report in English', async (source, words) => {
    const { el } = await render(item({ reason: 'ads', source }), {
      language: 'en',
    });

    expect(lamp(el)).toBe(words);
  });

  it("adds the reporter's text after the reason other, as plain text", async () => {
    const { el } = await render(
      item({ reason: 'other', text: 'Nu <b>a fost</b> client' }),
    );

    expect(lamp(el)).toBe(
      'Raportată de service: Altceva: Nu <b>a fost</b> client',
    );
    expect(el.querySelector('mf-lamp b')).toBeNull();
  });

  // The admin strings must say each reason as the server's own texts do.
  it.each(
    Object.entries(REVIEW_REPORT_REASON_TEXTS).flatMap(([reason, texts]) =>
      (['ro', 'en'] as const).map(
        (language) => [reason, language, texts[language]] as const,
      ),
    ),
  )(
    'words the reason %s in %s as the server does',
    async (reason, language, words) => {
      const { el } = await render(
        item({ reason: reason as Report['reason'], text: null }),
        {
          language,
        },
      );

      expect(lamp(el)).toMatch(new RegExp(`: ${words}$`));
    },
  );

  it('shows the reason other alone when the report has no text', async () => {
    const { el } = await render(item({ reason: 'other', text: null }));

    expect(lamp(el)).toBe('Raportată de service: Altceva');
  });

  it('shows the review text, and the garage name, as literal characters', async () => {
    const value = item();
    value.garage.name = 'Auto <i>Ion</i>';
    value.review.text = '<img src=x onerror=alert(1)> rău';
    const { el } = await render(value);

    expect(text(el.querySelector('.text'))).toBe(
      '<img src=x onerror=alert(1)> rău',
    );
    expect(el.querySelector('img, i')).toBeNull();
    expect(text(el.querySelector('.title'))).toBe(
      'Auto <i>Ion</i> · recenzie de 1,0',
    );
  });

  it('draws no text block for a review without text', async () => {
    const value = item();
    value.review.text = null;
    const { el } = await render(value);

    expect(el.querySelector('.text')).toBeNull();
  });

  it('lists the four facts of a confirmed job', async () => {
    const { el } = await render(item());

    expect(facts(el)).toEqual([
      'Lucrare confirmată: Ambreiaj, VW Golf · predată 20 oct. 2026',
      'Cont creat: 28 oct. 2026',
      'Recenzii identice de la același cont: 0',
      'Recenzii raportate de service înainte: 3, păstrate 1',
    ]);
  });

  it('leaves out the handover date the read does not carry', async () => {
    const value = item();
    value.facts.job.handedOverAt = null;
    const { el } = await render(value);

    expect(facts(el)[0]).toBe('Lucrare confirmată: Ambreiaj, VW Golf');
  });

  it('says there was no job, and that the account is gone', async () => {
    const value = item();
    value.facts.job = { kind: 'none' };
    value.facts.account = { deleted: true };
    const { el } = await render(value);

    expect(facts(el).slice(0, 2)).toEqual([
      'Fără lucrare: scrisă din profil (Nu prin MotorFix)',
      'Cont șters',
    ]);
  });

  it('lists the facts in English', async () => {
    const value = item();
    value.facts.identicalReviews = 2;
    const { el } = await render(value, { language: 'en' });

    expect(facts(el)).toEqual([
      'Confirmed job: Ambreiaj, VW Golf · handed over 20 Oct 2026',
      'Account created: 28 Oct 2026',
      'Identical reviews from the same account: 2',
      'Reviews this garage reported before: 3, kept 1',
    ]);
  });

  it('offers Keep and Remove the review, disabled, in the tab order, with the tip as description', async () => {
    const { el } = await render(item());

    const [keep, remove] = buttons(el);
    expect(buttons(el).map((b) => text(b))).toEqual([
      'Păstrează',
      'Șterge recenzia',
    ]);
    for (const button of [keep, remove]) {
      expect(button.getAttribute('aria-disabled')).toBe('true');
      expect(button.disabled).toBe(false);
      const tip = el.querySelector(
        `#${button.getAttribute('aria-describedby')}`,
      );
      expect(text(tip)).toBe('În curând');
    }
  });

  it('does nothing when a disabled slot is pressed', async () => {
    const { el, fixture } = await render(item());
    const before = el.innerHTML;

    buttons(el)[1].click();
    fixture.detectChanges();

    expect(el.innerHTML).toBe(before);
  });

  // @traces 1389-FR-010
  it('sends nothing when either slot is pressed', async () => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    const { el, fixture } = await render(item());

    for (const button of buttons(el)) button.click();
    fixture.detectChanges();

    TestBed.inject(HttpTestingController).verify();
  });

  it('reads as one labelled article: title, lamp words, text, facts and slots', async () => {
    const { el } = await render(item());

    expect(spoken(el.querySelector('article'))).toBe(
      [
        'Atelier Test · recenzie de 1,0',
        'Raportată de service: Insulte',
        'Mi-au stricat mașina.',
        'Lucrare confirmată: Ambreiaj, VW Golf · predată 20 oct. 2026',
        'Cont creat: 28 oct. 2026',
        'Recenzii identice de la același cont: 0',
        'Recenzii raportate de service înainte: 3, păstrate 1',
        'Păstrează',
        'Șterge recenzia',
        'În curând',
      ].join(' '),
    );
  });
});

describe('a reported reply', () => {
  it('names the garage and the author of the review it answers', async () => {
    const { el } = await render(reply());

    expect(el.querySelector('article')?.getAttribute('aria-label')).toBe(
      'Atelier Test · răspuns la recenzia lui Andrei P.',
    );
  });

  it('names it in English', async () => {
    const { el } = await render(reply(), { language: 'en' });

    expect(el.querySelector('article')?.getAttribute('aria-label')).toBe(
      "Atelier Test · reply to Andrei P.'s review",
    );
  });

  it("shows the author's report by its source, with the reason", async () => {
    const { el } = await render(reply({ reason: 'personal_data' }));

    expect(lamp(el)).toBe('Raportat de autor: Date personale');
  });

  it('follows the source on a reply too', async () => {
    const { el } = await render(reply({ source: 'automatic' }));

    expect(lamp(el)).toBe('Raportată automat: Insulte');
  });

  it('shows the reply, who posted it, and under it the review it answers', async () => {
    const { el } = await render(reply());

    expect(text(el.querySelector('.reply'))).toBe('Clientul minte.');
    expect(text(el.querySelector('.posted'))).toMatch(/^Atelier Test · /);
    expect(text(el.querySelector('.posted'))).not.toContain('editat');
    const answered = text(el.querySelector('.answered'));
    expect(answered).toContain('1,0');
    expect(answered).toContain('Mi-au stricat mașina.');
    expect(answered).toContain('Andrei P.');
  });

  it('says when the reply was edited', async () => {
    const { el } = await render(reply({}, '2026-10-29T09:00:00Z'));

    expect(text(el.querySelector('.posted'))).toMatch(/ · editat$/);
  });

  it('says edited in English', async () => {
    const { el } = await render(reply({}, '2026-10-29T09:00:00Z'), {
      language: 'en',
    });

    expect(text(el.querySelector('.posted'))).toMatch(/ · edited$/);
  });

  it('offers Keep the reply and Remove the reply, disabled', async () => {
    const { el } = await render(reply());

    expect(buttons(el).map((b) => text(b))).toEqual([
      'Păstrează răspunsul',
      'Șterge răspunsul',
    ]);
    expect(
      buttons(el).every((b) => b.getAttribute('aria-disabled') === 'true'),
    ).toBe(true);
  });

  it('labels the slots in English', async () => {
    const { el } = await render(reply(), { language: 'en' });

    expect(buttons(el).map((b) => text(b))).toEqual([
      'Keep the reply',
      'Remove the reply',
    ]);
    expect(text(el.querySelector('[role="tooltip"]'))).toBe('Coming soon');
  });
});

describe('the 48-hour mark', () => {
  it('is absent before the report is due', async () => {
    const { el } = await render(item());

    expect(el.querySelector('.overdue')).toBeNull();
  });

  it('shows once the report is due, in words', async () => {
    const { el } = await render(item({ dueAt: '2026-10-30T10:00:00Z' }));

    expect(text(el.querySelector('.overdue'))).toBe('Peste 48 de ore');
  });

  it('follows the time on screen, not the flag of the read', async () => {
    const { el, fixture } = await render(item({ overdue: false }));
    expect(el.querySelector('.overdue')).toBeNull();

    fixture.componentRef.setInput('now', new Date('2026-10-31T09:00:00Z'));
    fixture.detectChanges();

    expect(text(el.querySelector('.overdue'))).toBe('Peste 48 de ore');
  });

  it('reads Over 48 hours in English', async () => {
    const { el } = await render(item({ dueAt: '2026-10-29T10:00:00Z' }), {
      language: 'en',
    });

    expect(text(el.querySelector('.overdue'))).toBe('Over 48 hours');
  });
});
