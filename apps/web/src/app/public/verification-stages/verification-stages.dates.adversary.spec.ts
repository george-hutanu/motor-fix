import { TestBed } from '@angular/core/testing';
import { I18n } from '@motor-fix/i18n';

import { VerificationStages } from './verification-stages';

async function firstStage(submittedAt: string | null, language: 'ro' | 'en') {
  const i18n = TestBed.inject(I18n);
  await i18n.enter('public');
  if (language === 'en') await i18n.use('en');
  const fixture = TestBed.createComponent(VerificationStages);
  fixture.componentRef.setInput('status', 'submitted');
  fixture.componentRef.setInput('submittedAt', submittedAt);
  fixture.detectChanges();
  await fixture.whenStable();
  const name = (fixture.nativeElement as HTMLElement).querySelector(
    'ol.stages > li .name',
  );
  return (name?.textContent ?? '').replace(/\s+/g, ' ').trim();
}

afterEach(() => TestBed.resetTestingModule());

describe('the sending day in Bucharest', () => {
  // @traces 101-FR-002
  it.each([
    [
      'the last second of a winter day',
      '2027-02-14T21:59:59.000Z',
      'Submitted · 14 Feb 2027',
    ],
    [
      'the first second of the next winter day',
      '2027-02-14T22:00:00.000Z',
      'Submitted · 15 Feb 2027',
    ],
    [
      'the last second before the clocks go forward',
      '2027-03-27T21:59:59.000Z',
      'Submitted · 27 Mar 2027',
    ],
    [
      'midnight of the day the clocks go forward',
      '2027-03-27T22:00:00.000Z',
      'Submitted · 28 Mar 2027',
    ],
    [
      'the last second of a summer day',
      '2027-06-30T20:59:59.000Z',
      'Submitted · 30 Jun 2027',
    ],
    [
      'the first second of the next summer day',
      '2027-06-30T21:00:00.000Z',
      'Submitted · 1 Jul 2027',
    ],
    [
      'the last second before the clocks go back',
      '2027-10-30T20:59:59.000Z',
      'Submitted · 30 Oct 2027',
    ],
    [
      'midnight after the clocks go back',
      '2027-10-30T21:00:00.000Z',
      'Submitted · 31 Oct 2027',
    ],
    [
      'the new year as Bucharest sees it',
      '2027-12-31T22:00:00.000Z',
      'Submitted · 1 Jan 2028',
    ],
    [
      'the last second of the old year',
      '2027-12-31T21:59:59.000Z',
      'Submitted · 31 Dec 2027',
    ],
    [
      'a leap day at its edge',
      '2028-02-28T22:00:00.000Z',
      'Submitted · 29 Feb 2028',
    ],
  ])('reads %s', async (_, at, expected) => {
    expect(await firstStage(at, 'en')).toBe(expected);
  });

  // @traces 101-FR-002
  it('reads the same instant as the same day in both languages', async () => {
    expect(await firstStage('2027-03-27T22:00:00.000Z', 'ro')).toBe(
      'Trimis · 28 mart. 2027',
    );
  });

  // @traces 101-FR-002
  it('reads an offset timestamp by the instant, not by the date written', async () => {
    expect(await firstStage('2027-03-01T23:30:00-05:00', 'en')).toBe(
      'Submitted · 2 Mar 2027',
    );
  });

  // @traces 101-FR-002
  it('names the first stage alone for an empty sending time', async () => {
    expect(await firstStage('', 'en')).toBe('Submitted');
  });
});
