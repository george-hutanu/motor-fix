import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type {
  ActiveRequestAnswerDto,
  ActiveRequestDto,
} from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';

import { ActiveRequest } from './active-request';

// @traces 275-FR-005
// @traces 275-FR-010

const inWork: ActiveRequestDto = {
  booking: {
    confirmBy: new Date(Date.now() + 3_600_000).toISOString(),
    garage: { id: 'g1', name: 'Atelier Dinamo', slug: 'atelier-dinamo' },
    startsAt: new Date().toISOString(),
    status: 'confirmed',
  },
  car: { brand: 'BMW', model: '320d', year: 2016 },
  description: null,
  id: 'r1',
  job: {
    etaAt: null,
    finalPriceBani: null,
    startedAt: new Date().toISOString(),
    status: 'in_work',
    steps: [{ id: 's1', state: 'now', text: 'Plăcuțe noi' }],
  },
  jobs: [],
  mechanicName: null,
  range: null,
  saveSuggestion: null,
  stage: 'in_work',
};

type Answer = ActiveRequestAnswerDto | 'failed' | undefined;

async function render(
  answer: Answer,
  reconnecting: boolean,
  language: 'ro' | 'en' = 'ro',
) {
  TestBed.configureTestingModule({ providers: [provideRouter([])] });
  const i18n = TestBed.inject(I18n);
  await i18n.enter('driver');
  if (language === 'en') await i18n.use('en');
  const fixture = TestBed.createComponent(ActiveRequest);
  fixture.componentRef.setInput('answer', answer);
  fixture.componentRef.setInput('reconnecting', reconnecting);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  const element = fixture.nativeElement as HTMLElement;
  return {
    fixture,
    line: () => element.querySelector('.reconnecting'),
  };
}

afterEach(() => TestBed.resetTestingModule());

describe('the panel while the live stream is down', () => {
  it('says Reconectare… as a status under the stages, and drops it once back', async () => {
    const { fixture, line } = await render(
      { openCount: 1, request: inWork },
      true,
    );

    expect(line()?.textContent?.trim()).toBe('Reconectare…');
    expect(line()?.getAttribute('role')).toBe('status');
    expect(line()?.previousElementSibling?.classList.contains('stages')).toBe(
      true,
    );

    fixture.componentRef.setInput('reconnecting', false);
    fixture.detectChanges();
    expect(line()).toBeNull();
  });

  it('says Reconnecting… in English', async () => {
    const { line } = await render(
      { openCount: 1, request: inWork },
      true,
      'en',
    );

    expect(line()?.textContent?.trim()).toBe('Reconnecting…');
  });

  it.each([
    ['reading', undefined],
    ['failed', 'failed'],
    ['empty', { openCount: 0, request: null }],
  ] as [string, Answer][])('shows no line while %s', async (_state, answer) => {
    const { line } = await render(answer, true);

    expect(line()).toBeNull();
  });
});
