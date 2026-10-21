import { HttpErrorResponse } from '@angular/common/http';
import { Component, inject } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  type JobReviewContextDto,
  MeService,
  type ReviewDto,
  ReviewsService,
} from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';
import { type OverlayResult, Overlays } from '@motor-fix/overlays';
import { toast } from '@motor-fix/ui-cockpit';

import { ReviewTask } from './review-task';

jest.mock('@motor-fix/ui-cockpit', () => ({
  ...jest.requireActual('@motor-fix/ui-cockpit'),
  toast: jest.fn(),
}));

@Component({ template: '' })
class Host {
  readonly overlays = inject(Overlays);
}

const JOB = '6c1f0a52-3b7e-4d1a-9f0e-2a4b5c6d7e8f';

const context = (
  over: Partial<JobReviewContextDto> = {},
): JobReviewContextDto => ({
  author: { shortName: 'Andrei M.' },
  car: {
    brand: 'BMW',
    engine: '2.0',
    fuel: 'diesel',
    model: '320d',
    year: 2019,
  },
  eligibility: { jobId: JOB, offer: true, reason: null },
  emailConfirmed: true,
  existing: null,
  garage: { id: 'garage-1', name: 'Atelier Dinamo', slug: 'atelier-dinamo' },
  hasEmail: true,
  job: { id: JOB, status: 'done' },
  jobs: [
    {
      id: 'rj-1',
      jobTypeId: 'jt-1',
      nameEn: 'Oil change',
      nameRo: 'Schimb ulei',
      position: 0,
    },
    {
      id: 'rj-2',
      jobTypeId: 'jt-2',
      nameEn: 'Front brake pads',
      nameRo: 'Plăcuțe frână față',
      position: 1,
    },
  ],
  ...over,
});

const review = (over: Partial<ReviewDto> = {}): ReviewDto => ({
  id: 'review-1',
  jobId: JOB,
  paidBani: null,
  postedAt: '2026-10-21T09:00:00.000Z',
  rating: 4,
  status: 'published',
  text: null,
  ...over,
});

let read: jest.Mock;
let publish: jest.Mock;
let askAgain: jest.Mock;
let result: Promise<OverlayResult<ReviewDto>>;

async function settle() {
  for (let i = 0; i < 6; i++) {
    TestBed.tick();
    await new Promise((resolve) => setTimeout(resolve));
  }
}

async function open(
  options: {
    answer?: () => Promise<JobReviewContextDto>;
    jobId?: string;
    language?: 'ro' | 'en';
  } = {},
) {
  read = jest.fn(options.answer ?? (async () => context()));
  publish = jest.fn(async () => review());
  askAgain = jest.fn(async () => undefined);
  TestBed.configureTestingModule({
    providers: [
      {
        provide: ReviewsService,
        useValue: {
          reviewsControllerForJob: read,
          reviewsControllerPublish: publish,
        },
      },
      {
        provide: MeService,
        useValue: { meEmailConfirmationControllerAskAgain: askAgain },
      },
    ],
  });
  await TestBed.inject(I18n).enter('driver');
  if (options.language === 'en') await TestBed.inject(I18n).use('en');
  const host = TestBed.createComponent(Host);
  result = host.componentInstance.overlays.open<ReviewDto, { jobId?: string }>(
    ReviewTask,
    {
      confirmDiscard: false,
      data: { jobId: 'jobId' in options ? options.jobId : JOB },
      shape: 'drawer',
      title: 'driver.review.voices.v1',
    },
  );
  await settle();
}

const panel = () =>
  document.querySelector<HTMLElement>('mf-overlay-panel') as HTMLElement;
const task = () =>
  document.querySelector<HTMLElement>('mf-review-task') as HTMLElement;
const text = () => (task()?.textContent ?? '').replace(/\s+/g, ' ');

function field<T extends HTMLElement = HTMLInputElement>(label: string): T {
  const found = [...task().querySelectorAll('label')].find((l) =>
    l.textContent?.trim().startsWith(label),
  );
  const control = found?.htmlFor
    ? document.getElementById(found.htmlFor)
    : found?.querySelector('input, textarea');
  if (!control) throw new Error(`no ${label}`);
  return control as T;
}

function type(control: HTMLInputElement | HTMLTextAreaElement, value: string) {
  control.value = value;
  control.dispatchEvent(new Event('input', { bubbles: true }));
}

const radios = () => [
  ...task().querySelectorAll<HTMLInputElement>('input[type="radio"]'),
];

const button = (name: string) =>
  [...task().querySelectorAll('button')].find(
    (b) => b.textContent?.trim() === name,
  ) as HTMLButtonElement | undefined;

const WORDS = [
  'Nu m‑aș întoarce',
  'Au fost probleme',
  'Și‑au făcut treaba',
  'Lucru bine făcut',
  'Aș trimite un prieten',
];

async function rate(step: number) {
  radios()[step - 1].click();
  await settle();
}

const publishNow = async () => {
  button('Publică recenzia')?.click();
  await settle();
};

const refusal = (status: number, body: Record<string, unknown>) =>
  new HttpErrorResponse({ error: body, status });

afterEach(() => {
  document.querySelectorAll('.cdk-overlay-container').forEach((n) => {
    n.innerHTML = '';
  });
  jest.mocked(toast).mockClear();
  TestBed.resetTestingModule();
});

// @traces 022-FR-002 022-FR-003
// @traces 022-FR-004 022-FR-006 022-FR-007
describe('the review drawer', () => {
  it('asks how the repair went at the job’s garage', async () => {
    await open();

    expect(read).toHaveBeenCalledWith({ jobId: JOB });
    expect(panel().querySelector('h2')?.textContent?.trim()).toBe(
      'Cum a mers reparația?',
    );
    expect(text()).toContain('Atelier Dinamo');
  });

  it('shows the car and the work from the job, locked', async () => {
    await open();

    const car = field('Mașina ta');
    expect(car.value).toBe('BMW 320d 2.0');
    expect(car.readOnly).toBe(true);
    const works = [...task().querySelectorAll('.works li')].map((li) =>
      li.textContent?.trim(),
    );
    expect(works).toEqual(['Schimb ulei', 'Plăcuțe frână față']);
    expect(task().querySelector('.works button, .works input')).toBeNull();
  });

  it('starts on 4 and shows only the chosen step’s words', async () => {
    await open();

    expect(radios().map((r) => r.value)).toEqual(['1', '2', '3', '4', '5']);
    expect(radios().find((r) => r.checked)?.value).toBe('4');
    expect(task().querySelector('fieldset')?.getAttribute('aria-label')).toBe(
      'Notă de la 1 la 5',
    );
    expect(text()).toContain('Lucru bine făcut');
    for (const [i, words] of WORDS.entries()) {
      await rate(i + 1);
      expect(text()).toContain(words);
      for (const other of WORDS.filter((w) => w !== words))
        expect(text()).not.toContain(other);
    }
  });

  it('offers an optional amount and comment, with the hint and the privacy line', async () => {
    await open();

    const amount = field('Cât ai plătit');
    expect(amount.getAttribute('inputmode')).toBe('numeric');
    expect(amount.placeholder).toBe('890 lei');
    expect(text()).toContain('opțional');
    const comment = field<HTMLTextAreaElement>('Comentariul tău');
    expect(comment.tagName).toBe('TEXTAREA');
    expect(comment.placeholder).toBe(
      'Prețul a fost cel din ofertă? A fost gata la timp? Te‑ai mai duce?',
    );
    expect(text()).toContain(
      'Apar doar Andrei M., mașina și lucrarea. Niciodată numărul de înmatriculare sau telefonul.',
    );
  });
});

// @traces 022-FR-008 022-FR-010
describe('publishing from the drawer', () => {
  it('posts the job and the rating alone, then confirms on the garage’s profile', async () => {
    await open();

    await rate(5);
    await publishNow();

    expect(publish).toHaveBeenCalledWith({
      body: { jobId: JOB, rating: 5 },
    });
    expect(text()).toContain('Publicată. E acum pe profilul Atelier Dinamo.');
    expect(task().querySelector('form')).toBeNull();
  });

  it('closes with the review from the confirmation', async () => {
    await open();
    await publishNow();

    button('Închide')?.click();

    expect(await result).toEqual(review());
  });

  it('holds the button while the review is on its way', async () => {
    await open();
    let answer: (r: ReviewDto) => void = () => undefined;
    publish.mockImplementationOnce(
      () =>
        new Promise<ReviewDto>((resolve) => {
          answer = resolve;
        }),
    );

    await publishNow();
    await publishNow();

    expect(button('Publică recenzia')?.hasAttribute('disabled')).toBe(true);
    expect(publish).toHaveBeenCalledTimes(1);
    answer(review());
    await settle();
    expect(text()).toContain('Publicată.');
  });

  it('reads English', async () => {
    await open({ language: 'en' });

    expect(panel().querySelector('h2')?.textContent?.trim()).toBe(
      'How did the repair go?',
    );
    expect(text()).toContain('Good work');
    expect(field('Your car').value).toBe('BMW 320d 2.0');
    expect(text()).toContain('Oil change');
    expect(field('What you paid')).toBeDefined();
    expect(field('Your comment')).toBeDefined();
    expect(text()).toContain(
      'Only Andrei M., your car and the job are shown. Never your plate or phone number.',
    );
    button('Post review')?.click();
    await settle();
    expect(text()).toContain("Posted. It's on the Atelier Dinamo profile now.");
    expect(button('Close')).toBeDefined();
  });
});

// @traces 022-FR-005 022-FR-006 022-FR-013
describe('the amount and the comment', () => {
  it.each([
    ['4.200,50', 420_050],
    ['4 200 lei', 420_000],
    ['890', 89_000],
  ])('sends %p as %p bani', async (typed, paidBani) => {
    await open();

    type(field('Cât ai plătit'), typed);
    await publishNow();

    expect(publish).toHaveBeenCalledWith({
      body: { jobId: JOB, paidBani, rating: 4 },
    });
  });

  it('sends the comment trimmed', async () => {
    await open();

    type(field<HTMLTextAreaElement>('Comentariul tău'), '  Gata la timp.  ');
    await publishNow();

    expect(publish).toHaveBeenCalledWith({
      body: { jobId: JOB, rating: 4, text: 'Gata la timp.' },
    });
  });

  it.each([
    ['0', 'Suma trebuie să fie mai mare de 0.'],
    ['-50', 'Suma trebuie să fie mai mare de 0.'],
    ['1.000.001', 'Cel mult 1.000.000 lei.'],
    ['4.200,505', 'Cel mult două zecimale.'],
    ['42a', 'Scrie suma în lei, de exemplu 4.200 sau 4.200,50.'],
  ])('refuses %p at the field', async (typed, message) => {
    await open();

    type(field('Cât ai plătit'), typed);
    await publishNow();

    expect(publish).not.toHaveBeenCalled();
    expect(text()).toContain(message);
  });

  it('counts a comment over 2,000 characters and holds the button', async () => {
    await open();

    type(field<HTMLTextAreaElement>('Comentariul tău'), 'x'.repeat(2001));
    await settle();

    expect(text()).toContain('2.001 / 2.000');
    expect(button('Publică recenzia')?.disabled).toBe(true);
    type(field<HTMLTextAreaElement>('Comentariul tău'), 'x'.repeat(2000));
    await settle();
    expect(button('Publică recenzia')?.disabled).toBe(false);
  });

  it('shows a refused amount at its field, keeping what was typed', async () => {
    await open();
    publish.mockRejectedValueOnce(
      refusal(422, {
        code: 'validation_failed',
        errors: [{ code: 'range', field: 'paidBani' }],
      }),
    );

    type(field('Cât ai plătit'), '890');
    await publishNow();

    expect(text()).toContain(
      'Suma trebuie să fie între 0,01 și 1.000.000 lei.',
    );
    expect(field('Cât ai plătit').value).toBe('890');
  });
});

// @traces 022-FR-012
// @traces 022-FR-013 022-FR-023
describe('a job that cannot be reviewed', () => {
  it.each([
    ['a job that is not found', JOB],
    ['an id that is not a UUID', undefined],
  ])('says so for %s', async (_, jobId) => {
    await open({
      answer: async () => {
        throw refusal(404, { code: 'not_found' });
      },
      jobId,
    });

    expect(text()).toContain('Nu am găsit lucrarea.');
    expect(task().querySelector('form')).toBeNull();
    if (!jobId) expect(read).not.toHaveBeenCalled();
  });

  it('says a job not done yet cannot be reviewed', async () => {
    await open({
      answer: async () =>
        context({
          eligibility: { jobId: JOB, offer: false, reason: 'job_not_done' },
          job: { id: JOB, status: 'in_work' },
        }),
    });

    expect(text()).toContain('Poți scrie o recenzie după ce lucrarea e gata.');
    expect(task().querySelector('form')).toBeNull();
  });

  it('says so when the job turns out not done on publishing', async () => {
    await open();
    publish.mockRejectedValueOnce(
      refusal(409, {
        code: 'job_not_done',
        currentStatus: 'cancelled',
        entity: 'job',
      }),
    );

    await publishNow();

    expect(text()).toContain('Poți scrie o recenzie după ce lucrarea e gata.');
  });

  it('shows the review already written', async () => {
    await open({
      answer: async () =>
        context({
          existing: review({
            paidBani: 420_050,
            rating: 3,
            text: 'Au întârziat o zi.',
          }),
        }),
    });

    expect(task().querySelector('form')).toBeNull();
    expect(text()).toContain('3');
    expect(text()).toContain('Și‑au făcut treaba');
    expect(text()).toContain('4.200,50 lei');
    expect(text()).toContain('Au întârziat o zi.');
    expect(text()).toContain('21 oct. 2026');
  });

  it('notes a reported review', async () => {
    await open({
      answer: async () => context({ existing: review({ status: 'reported' }) }),
    });

    expect(text()).toContain('Recenzia a fost raportată și e în verificare.');
  });

  it('reads the review back when one was written meanwhile', async () => {
    await open();
    publish.mockRejectedValueOnce(
      refusal(409, {
        code: 'already_reviewed',
        currentStatus: 'published',
        entity: 'review',
      }),
    );
    read.mockResolvedValueOnce(
      context({ existing: review({ rating: 2, text: 'Altă părere.' }) }),
    );

    await publishNow();

    expect(read).toHaveBeenCalledTimes(2);
    expect(text()).toContain('Au fost probleme');
    expect(text()).toContain('Altă părere.');
    expect(task().querySelector('form')).toBeNull();
  });

  it('shows an unknown refusal by its code, keeping what was typed', async () => {
    await open();
    publish.mockRejectedValueOnce(refusal(409, { code: 'garage_closed' }));

    type(field('Cât ai plătit'), '890');
    await publishNow();

    expect(text()).toContain('garage_closed');
    expect(field('Cât ai plătit').value).toBe('890');
  });
});

const OWN_GARAGE = 'Nu poți scrie o recenzie pentru propriul service.';
const REMOVED =
  'Recenzia ta a fost ștearsă de MotorFix; poți doar contesta decizia.';

// @traces 023-FR-014 023-FR-015 023-FR-016
describe('a job the driver may not review', () => {
  it('says staff cannot review their own garage, in place of the form', async () => {
    await open({
      answer: async () =>
        context({
          eligibility: { jobId: JOB, offer: false, reason: 'own_garage' },
        }),
    });

    expect(text()).toContain(OWN_GARAGE);
    expect(task().querySelector('form')).toBeNull();
  });

  it('says so when the publish answers own_garage', async () => {
    await open();
    publish.mockRejectedValueOnce(refusal(403, { code: 'own_garage' }));

    await publishNow();

    expect(text()).toContain(OWN_GARAGE);
    expect(task().querySelector('form')).toBeNull();
  });

  it('shows only the removed message for a review MotorFix removed', async () => {
    await open({
      answer: async () =>
        context({
          eligibility: { jobId: JOB, offer: false, reason: 'review_removed' },
          existing: review({ rating: 2, status: 'removed', text: 'Hm.' }),
        }),
    });

    expect(text()).toContain(REMOVED);
    expect(text()).not.toContain('Hm.');
    expect(task().querySelector('form')).toBeNull();
  });

  it('says so when the publish answers review_removed', async () => {
    await open();
    publish.mockRejectedValueOnce(
      refusal(409, {
        code: 'review_removed',
        currentStatus: 'removed',
        entity: 'review',
      }),
    );

    await publishNow();

    expect(text()).toContain(REMOVED);
    expect(task().querySelector('form')).toBeNull();
  });

  it.each([
    ['own_garage', 'You cannot review your own garage.'],
    [
      'review_removed',
      'MotorFix removed your review; you can only appeal the decision.',
    ],
  ] as const)('reads %s in English', async (reason, message) => {
    await open({
      answer: async () =>
        context({ eligibility: { jobId: JOB, offer: false, reason } }),
      language: 'en',
    });

    expect(text()).toContain(message);
  });
});

// @traces 022-FR-011
describe('an e-mail not confirmed', () => {
  it('asks for the confirmation in place of publishing, and sends the link again', async () => {
    await open({
      answer: async () => context({ emailConfirmed: false }),
    });

    expect(button('Publică recenzia')).toBeUndefined();
    expect(text()).toContain(
      'Confirmă‑ți adresa de e‑mail ca să publici recenzia.',
    );
    button('Trimite din nou linkul')?.click();
    await settle();

    expect(askAgain).toHaveBeenCalledTimes(1);
    expect(toast).toHaveBeenCalledWith('Ți‑am trimis din nou linkul.');
  });

  it('asks for the confirmation without the link for an account with no e-mail', async () => {
    await open({
      answer: async () => context({ emailConfirmed: false, hasEmail: false }),
    });

    expect(button('Publică recenzia')).toBeUndefined();
    expect(text()).toContain(
      'Confirmă‑ți adresa de e‑mail ca să publici recenzia.',
    );
    expect(button('Trimite din nou linkul')).toBeUndefined();
  });

  it('asks for the confirmation after a refusal on publishing', async () => {
    await open();
    publish.mockRejectedValueOnce(
      refusal(409, { code: 'email_not_confirmed' }),
    );

    await publishNow();

    expect(text()).toContain(
      'Confirmă‑ți adresa de e‑mail ca să publici recenzia.',
    );
    expect(button('Publică recenzia')).toBeUndefined();
  });
});

// @traces 022-FR-013
describe('a failure', () => {
  it.each([
    ['the network', new HttpErrorResponse({ status: 0 })],
    ['the server', refusal(503, { code: 'unavailable' })],
  ])('from %s shows a toast and keeps every value', async (_, failure) => {
    await open();
    publish.mockRejectedValueOnce(failure);

    await rate(2);
    type(field('Cât ai plătit'), '890');
    type(field<HTMLTextAreaElement>('Comentariul tău'), 'Gata la timp.');
    await publishNow();

    expect(toast).toHaveBeenCalledWith(
      'Nu am putut publica recenzia. Încearcă din nou.',
    );
    expect(radios().find((r) => r.checked)?.value).toBe('2');
    expect(field('Cât ai plătit').value).toBe('890');
    expect(field<HTMLTextAreaElement>('Comentariul tău').value).toBe(
      'Gata la timp.',
    );
    expect(
      button('Publică recenzia')?.getAttribute('aria-disabled'),
    ).toBeNull();
  });

  it('shows the loading state until the job is read', async () => {
    let answer: (c: JobReviewContextDto) => void = () => undefined;
    await open({
      answer: () =>
        new Promise<JobReviewContextDto>((resolve) => {
          answer = resolve;
        }),
    });

    expect(text()).toContain('Se încarcă lucrarea…');
    expect(task().querySelector('form')).toBeNull();
    answer(context());
    await settle();
    expect(task().querySelector('form')).not.toBeNull();
  });

  it('offers to read the job again when the read fails', async () => {
    await open({
      answer: async () => {
        throw new HttpErrorResponse({ status: 0 });
      },
    });

    expect(text()).toContain('Nu am putut încărca lucrarea.');
    expect(task().querySelector('form')).toBeNull();
    read.mockResolvedValueOnce(context());
    button('Încearcă din nou')?.click();
    await settle();

    expect(read).toHaveBeenCalledTimes(2);
    expect(task().querySelector('form')).not.toBeNull();
  });
});
