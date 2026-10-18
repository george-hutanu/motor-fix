import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { EventKind, LiveMessage } from '@motor-fix/contracts';
import {
  AdminService,
  type VerificationChangeDto,
  type VerificationFileChangesDto,
} from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';
import { filter, Subject } from 'rxjs';

import { VerificationChanges } from './verification-changes';
import { Live } from '../live';

const REQUESTED = '2026-10-03T09:00:00.000Z';

const change = (
  extra: Partial<VerificationChangeDto>,
): VerificationChangeDto => ({
  action: 'update',
  area: 'profile',
  at: '2026-10-05T09:00:00.000Z',
  field: null,
  kind: null,
  newValue: null,
  oldValue: null,
  subjectType: 'garage',
  ...extra,
});

const answerOf = (
  changes: VerificationChangeDto[],
  total = changes.length,
): VerificationFileChangesDto => ({
  changes,
  requestedAt: REQUESTED,
  resubmitted: true,
  total,
});

@Component({
  imports: [VerificationChanges],
  template:
    '<mf-verification-changes fileId="f" [photos]="photos()" [brands]="brands()" />',
})
class Host {
  readonly photos = signal(3);
  readonly brands = signal(2);
}

async function settle() {
  for (let i = 0; i < 6; i++) {
    TestBed.tick();
    await new Promise((resolve) => setTimeout(resolve));
  }
}

async function open(
  answer: VerificationFileChangesDto,
  language: 'ro' | 'en' = 'ro',
  counts?: { photos: number; brands: number },
) {
  const events = new Subject<LiveMessage>();
  TestBed.configureTestingModule({
    providers: [
      {
        provide: AdminService,
        useValue: {
          verificationFileControllerChanges: jest.fn(async () => answer),
        },
      },
      {
        provide: Live,
        useValue: {
          on: (kinds: readonly EventKind[]) =>
            events.pipe(
              filter((m) => (kinds as readonly string[]).includes(m.kind)),
            ),
          resync: new Subject<void>(),
        },
      },
    ],
  });
  const i18n = TestBed.inject(I18n);
  if (language === 'en') await i18n.use('en');
  await i18n.enter('admin');
  const fixture = TestBed.createComponent(Host);
  if (counts) {
    fixture.componentInstance.photos.set(counts.photos);
    fixture.componentInstance.brands.set(counts.brands);
  }
  document.body.append(fixture.nativeElement);
  await settle();
  return fixture.nativeElement as HTMLElement;
}

const text = (el: Element | null | undefined) =>
  (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
const lines = (host: HTMLElement, area: string) =>
  [...host.querySelectorAll(`[data-area="${area}"] li`)].map((li) => text(li));
const more = (host: HTMLElement) => host.querySelector('.more');

const photo = (action: 'create' | 'delete') =>
  change({ action, area: 'photos', subjectType: 'garage_photo' });

afterEach(() => {
  TestBed.resetTestingModule();
  document.body.innerHTML = '';
});

// @traces 304-FR-009
describe('the changes panel against hostile answers', () => {
  it('shows no "more" line when exactly 200 changes come with a total of 200', async () => {
    const many = Array.from({ length: 200 }, (_, n) =>
      change({ field: `f${n}`, newValue: 'b', oldValue: 'a' }),
    );

    const host = await open(answerOf(many, 200));

    expect([host.querySelectorAll('li').length, more(host)]).toEqual([
      200,
      null,
    ]);
  });

  it('ends with "and 2 more changes" when the total is 202 for 200 shown', async () => {
    const many = Array.from({ length: 200 }, (_, n) =>
      change({ field: `f${n}`, newValue: 'b', oldValue: 'a' }),
    );

    const host = await open(answerOf(many, 202), 'en');

    expect(text(more(host))).toBe('and 2 more changes');
  });

  it('renders markup in a stored value as text, never as elements', async () => {
    const host = await open(
      answerOf([
        change({
          field: 'phone',
          newValue: '<img src=x onerror=alert(1)>',
          oldValue: '<b>old</b>',
        }),
      ]),
    );

    expect([
      host.querySelectorAll('img, b').length,
      lines(host, 'profile'),
    ]).toEqual([0, ['Telefonul: <b>old</b> → <img src=x onerror=alert(1)>']]);
  });

  it('writes an empty and a null earlier value as a dash', async () => {
    const host = await open(
      answerOf([
        change({ field: 'phone', newValue: '+40733000111', oldValue: '' }),
      ]),
    );

    expect(lines(host, 'profile')).toEqual(['Telefonul: — → +40733000111']);
  });

  it('says "modificat" when a count worked back would be negative', async () => {
    const host = await open(
      answerOf([photo('create'), photo('create'), photo('create')]),
      'ro',
      { brands: 0, photos: 1 },
    );

    expect(lines(host, 'photos')).toEqual(['Fotografii: modificat']);
  });

  it('says "changed" for a photo added and another removed that leave the count where it was', async () => {
    const host = await open(answerOf([photo('create'), photo('delete')]), 'en');

    expect(lines(host, 'photos')).toEqual(['Photos: changed']);
  });

  it('keeps the groups in order whatever order the changes arrive in', async () => {
    const host = await open(
      answerOf([
        change({
          action: 'create',
          area: 'documents',
          kind: 'rar_authorisation',
          subjectType: 'legal_document',
        }),
        photo('create'),
        change({
          area: 'prices',
          field: 'price_min_bani',
          newValue: 1,
          oldValue: 2,
          subjectType: 'garage_price',
        }),
        change({ field: 'phone', newValue: 'b', oldValue: 'a' }),
      ]),
    );

    expect(
      [...host.querySelectorAll('[data-area]')].map((e) =>
        e.getAttribute('data-area'),
      ),
    ).toEqual(['profile', 'prices', 'photos', 'documents']);
  });

  it('shows the empty message and no group for an answer of no changes', async () => {
    const host = await open(answerOf([]), 'en');

    expect([
      text(host.querySelector('.empty')),
      host.querySelectorAll('[data-area]').length,
    ]).toEqual(['No change recorded since the request', 0]);
  });
});
