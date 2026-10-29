import { readFileSync } from 'node:fs';
import { join } from 'node:path';

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

const base: ActiveRequestDto = {
  booking: null,
  car: { brand: 'BMW', model: '320d', year: 2016 },
  description: null,
  id: 'r1',
  job: null,
  jobs: [],
  mechanicName: null,
  range: null,
  stage: 'sent',
};

const withStage = (
  stage: ActiveRequestDto['stage'],
): ActiveRequestAnswerDto => ({
  openCount: 1,
  request: { ...base, stage },
});

async function mount(
  answer: ActiveRequestAnswerDto | 'failed' | undefined,
  reconnecting?: boolean,
) {
  TestBed.configureTestingModule({ providers: [provideRouter([])] });
  await TestBed.inject(I18n).enter('driver');
  const fixture = TestBed.createComponent(ActiveRequest);
  fixture.componentRef.setInput('answer', answer);
  if (reconnecting !== undefined)
    fixture.componentRef.setInput('reconnecting', reconnecting);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  const el = fixture.nativeElement as HTMLElement;
  return { el, fixture, lines: () => el.querySelectorAll('.reconnecting') };
}

afterEach(() => TestBed.resetTestingModule());

describe('the reconnecting line under attack', () => {
  it('is absent when the input is never set', async () => {
    const { lines } = await mount(withStage('in_work'));

    expect(lines()).toHaveLength(0);
  });

  it.each(['sent', 'quoted', 'booked', 'in_work', 'done'] as const)(
    'shows exactly one line on the %s stage',
    async (stage) => {
      const { lines } = await mount(withStage(stage), true);

      expect(lines()).toHaveLength(1);
    },
  );

  it('shows one line after the input flips many times and ends true', async () => {
    const { fixture, lines } = await mount(withStage('in_work'), false);

    for (let i = 0; i < 20; i++) {
      fixture.componentRef.setInput('reconnecting', i % 2 === 0);
      fixture.detectChanges();
    }
    fixture.componentRef.setInput('reconnecting', true);
    fixture.detectChanges();

    expect(lines()).toHaveLength(1);
  });

  it('drops the line when the answer turns into the error state', async () => {
    const { fixture, lines } = await mount(withStage('in_work'), true);

    fixture.componentRef.setInput('answer', 'failed');
    fixture.detectChanges();

    expect(lines()).toHaveLength(0);
  });

  it('keeps the line text unchanged when the answer is re-read in place', async () => {
    const { fixture, lines } = await mount(withStage('in_work'), true);

    fixture.componentRef.setInput('answer', withStage('done'));
    fixture.detectChanges();

    expect(lines()[0]?.textContent?.trim()).toBe('Reconectare…');
  });

  it('is a polite status with no button or icon inside', async () => {
    const { lines } = await mount(withStage('in_work'), true);
    const line = lines()[0] as HTMLElement;

    expect(line.tagName).toBe('P');
    expect(line.querySelectorAll('button, svg, img, a')).toHaveLength(0);
    expect(line.getAttribute('aria-live')).not.toBe('assertive');
  });
});

describe('the reconnecting text and wiring', () => {
  const root = join(__dirname, '../../../../../..');
  const read = (p: string) => JSON.parse(readFileSync(join(root, p), 'utf8'));

  it('exists in Romanian and English under the driver panel', () => {
    expect(read('libs/i18n/src/driver/ro.json').active.reconnecting).toBe(
      'Reconectare…',
    );
    expect(read('libs/i18n/src/driver/en.json').active.reconnecting).toBe(
      'Reconnecting…',
    );
  });

  it.each([
    ['apps/web/src/app/dashboard/driver-home/driver-home'],
    ['apps/web/src/app/dashboard/requests-view/requests-view'],
  ])('%s binds the panel to the live offline signal', (file) => {
    const html = readFileSync(join(root, `${file}.html`), 'utf8');
    const ts = readFileSync(join(root, `${file}.ts`), 'utf8');

    expect(html).toContain('[reconnecting]="reconnecting()"');
    expect(ts).toContain('inject(Live).offline');
  });
});
