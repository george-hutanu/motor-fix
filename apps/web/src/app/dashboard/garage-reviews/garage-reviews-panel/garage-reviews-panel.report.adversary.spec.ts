import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { EventKind, LiveMessage } from '@motor-fix/contracts';
import {
  type GarageStaffReviewsPageDto,
  type MeDto,
  ReviewsService,
} from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';
import { filter, Subject } from 'rxjs';

import { GarageReviewsPanel } from './garage-reviews-panel';
import { Live } from '../../live';
import { openReportReview } from '../../report-review-dialog/open-report-review';
import { Session } from '../../session';
import { staffPage, staffReview } from '../garage-reviews.testing';

jest.mock('../../report-review-dialog/open-report-review', () => ({
  openReportReview: jest.fn(),
}));
const opened = openReportReview as jest.Mock;

const GARAGE = 'garage-1';
const me = () =>
  ({
    capabilities: ['garage.reviews'],
    garageAccess: [
      { features: {}, garageId: GARAGE, role: 'owner', status: 'approved' },
    ],
    garageId: GARAGE,
  }) as unknown as MeDto;

@Component({
  imports: [GarageReviewsPanel],
  template: `<mf-garage-reviews-panel [limit]="limit" />`,
})
class Host {
  limit: number | undefined = undefined;
}

let events: Subject<LiveMessage>;
let read: jest.Mock;

const answerFor = (id: string) => ({
  dueAt: '2026-10-27T12:00:00.000Z',
  id: `rep-${id}`,
  reason: 'insults',
  review: { id, status: 'reported' },
  status: 'pending',
});

async function render({
  answer = async () =>
    staffPage({
      items: [staffReview({ id: 'r-1' }), staffReview({ id: 'r-2' })],
    }),
  limit,
}: {
  answer?: (query: {
    garageId: string;
    page: number;
  }) => Promise<GarageStaffReviewsPageDto>;
  limit?: number;
} = {}) {
  events = new Subject();
  read = jest.fn(answer);
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      {
        provide: ReviewsService,
        useValue: { garageReviewsControllerRead: read },
      },
      { provide: Session, useValue: { shown: signal(me()) } },
      {
        provide: Live,
        useValue: {
          events,
          on: (kinds: readonly EventKind[]) =>
            events.pipe(
              filter((m) => (kinds as readonly string[]).includes(m.kind)),
            ),
          resync: new Subject<void>(),
        },
      },
    ],
  });
  await TestBed.inject(I18n).enter('garage');
  const fixture = TestBed.createComponent(Host);
  fixture.componentInstance.limit = limit;
  const element = fixture.nativeElement as HTMLElement;
  const settle = async () => {
    for (let i = 0; i < 4; i++) {
      fixture.detectChanges();
      await fixture.whenStable();
      await new Promise((r) => setTimeout(r, 0));
    }
  };
  return { element, settle };
}

const rowsOf = (element: HTMLElement) => [
  ...element.querySelectorAll<HTMLElement>('article[mf-garage-review-row]'),
];
const buttons = (element: HTMLElement) => [
  ...element.querySelectorAll<HTMLButtonElement>('button[data-report-button]'),
];
const tagged = (element: HTMLElement) =>
  rowsOf(element).map((row) => row.querySelector('[data-reported]') !== null);

afterEach(() => {
  opened.mockReset();
  TestBed.resetTestingModule();
});

// @traces 1382-FR-005
describe('reporting from the panel at its edges', () => {
  it('opens the task for the second row, not the first', async () => {
    opened.mockResolvedValue('cancelled');
    const { element, settle } = await render();
    await settle();

    buttons(element)[1].click();
    await settle();

    expect(opened.mock.calls[0][1]).toMatchObject({ id: 'r-2' });
  });

  it('opens one task when the button is pressed twice while the first still loads', async () => {
    let finish: (value: unknown) => void = () => undefined;
    opened.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const { element, settle } = await render();
    await settle();

    buttons(element)[0].click();
    buttons(element)[1].click();
    await settle();
    finish('cancelled');
    await settle();

    expect(opened).toHaveBeenCalledTimes(1);
  });

  it('lets the owner press again after the task failed to load', async () => {
    opened.mockRejectedValueOnce(new Error('chunk failed'));
    opened.mockResolvedValueOnce('cancelled');
    const { element, settle } = await render();
    await settle();

    buttons(element)[0].click();
    await settle();
    expect(tagged(element)).toEqual([false, false]);
    expect(buttons(element)).toHaveLength(2);

    buttons(element)[0].click();
    await settle();

    expect(opened).toHaveBeenCalledTimes(2);
  });

  it('shows two reviews reported one after the other both reported', async () => {
    opened.mockResolvedValueOnce(answerFor('r-1'));
    opened.mockResolvedValueOnce(answerFor('r-2'));
    const { element, settle } = await render();
    await settle();

    buttons(element)[0].click();
    await settle();
    buttons(element)[0].click();
    await settle();

    expect(tagged(element)).toEqual([true, true]);
    expect(buttons(element)).toHaveLength(0);
  });

  it('marks nothing and breaks nothing when the answer names a review not in the list', async () => {
    opened.mockResolvedValue(answerFor('r-404'));
    const { element, settle } = await render();
    await settle();

    buttons(element)[0].click();
    await settle();

    expect(tagged(element)).toEqual([false, false]);
    expect(rowsOf(element)).toHaveLength(2);
  });

  it('shows the row reported in Recenzii noi too, with a limit', async () => {
    opened.mockResolvedValue(answerFor('r-1'));
    const { element, settle } = await render({ limit: 5 });
    await settle();

    buttons(element)[0].click();
    await settle();

    expect(tagged(element)).toEqual([true, false]);
  });

  it('reads exactly once more per refusal and shows the re-read state', async () => {
    opened.mockResolvedValue('refused');
    let calls = 0;
    const { element, settle } = await render({
      answer: async () => {
        calls += 1;
        return staffPage({
          items:
            calls === 1
              ? [staffReview({ id: 'r-1' })]
              : [
                  staffReview({
                    id: 'r-1',
                    reportRefusal: 'already_reported',
                    status: 'reported',
                  }),
                ],
        });
      },
    });
    await settle();

    buttons(element)[0].click();
    await settle();

    expect(read).toHaveBeenCalledTimes(2);
    expect(tagged(element)).toEqual([true]);
    expect(buttons(element)).toHaveLength(0);
  });

  it('keeps a row reported from the answer when the live re-read already shows it reported', async () => {
    opened.mockResolvedValue(answerFor('r-1'));
    const { element, settle } = await render({
      answer: async () =>
        staffPage({
          items: [
            staffReview({
              id: 'r-1',
              reportRefusal: 'already_reported',
              status: 'reported',
            }),
          ],
        }),
    });
    await settle();

    expect(tagged(element)).toEqual([true]);
    expect(buttons(element)).toHaveLength(0);
  });

  it('stops offering the button when the re-read shows the review kept by an admin', async () => {
    opened.mockResolvedValue('cancelled');
    const { element, settle } = await render({
      answer: async () =>
        staffPage({
          items: [staffReview({ id: 'r-1', reportRefusal: 'already_kept' })],
        }),
    });
    await settle();

    const [only] = buttons(element);
    only.click();
    await settle();

    expect(only.getAttribute('aria-disabled')).toBe('true');
    expect(opened).not.toHaveBeenCalled();
  });
});
