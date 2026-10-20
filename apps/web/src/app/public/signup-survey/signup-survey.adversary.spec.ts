import { type ComponentFixture, TestBed } from '@angular/core/testing';
import type { SurveySection } from '@motor-fix/contracts/listing-survey';
import { I18n } from '@motor-fix/i18n';

import { SignupSurvey } from './signup-survey';

const text = (element: Element | null | undefined) =>
  (element?.textContent ?? '').replace(/\s+/g, ' ').trim();

const settle = async (fixture: ComponentFixture<SignupSurvey>) => {
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
};

async function open(value: SurveySection = {}, busy = false) {
  await TestBed.inject(I18n).enter('public');
  const fixture = TestBed.createComponent(SignupSurvey);
  const changes: SurveySection[] = [];
  let finishes = 0;
  let backs = 0;
  fixture.componentInstance.valueChange.subscribe((next) => {
    changes.push(next);
    fixture.componentRef.setInput('value', next);
  });
  fixture.componentInstance.finish.subscribe(() => finishes++);
  fixture.componentInstance.back.subscribe(() => backs++);
  fixture.componentRef.setInput('value', value);
  fixture.componentRef.setInput('busy', busy);
  await settle(fixture);
  const host = fixture.nativeElement as HTMLElement;
  return {
    backs: () => backs,
    changes,
    finishes: () => finishes,
    fixture,
    host,
  };
}

const forward = (host: HTMLElement) =>
  host.querySelector('button.forward') as HTMLButtonElement;
const radios = (host: HTMLElement) => [
  ...host.querySelectorAll<HTMLElement>('[role="radio"]'),
];
const counter = (host: HTMLElement) => text(host.querySelector('.counter'));

const FULL: SurveySection = {
  foundVia: 'garage',
  liftsCount: '0',
  mechanicsCount: '0',
  wantsDaySheets: false,
  wantsLiveMedia: true,
};

describe('SignupSurvey under odd use', () => {
  afterEach(() => TestBed.resetTestingModule());

  // @traces 1359-FR-011
  it('emits no finish from the summary while the save is in flight', async () => {
    const { finishes, fixture, host } = await open(FULL, true);

    forward(host).click();
    forward(host).click();
    await settle(fixture);

    expect(finishes()).toBe(0);
  });

  // @traces 1359-FR-011
  it('emits one finish per press of the create button when idle', async () => {
    const { finishes, fixture, host } = await open(FULL);

    forward(host).click();
    await settle(fixture);

    expect(finishes()).toBe(1);
  });

  // @traces 1359-FR-010
  it('opens at the first question when only the last one is answered', async () => {
    const { host } = await open({ foundVia: 'social' });

    expect(counter(host)).toContain('1 / 5');
    expect(forward(host).disabled).toBe(true);
  });

  // @traces 1359-FR-004
  it('picks nothing for a key that is not an arrow', async () => {
    const { changes, fixture, host } = await open({ mechanicsCount: '1-2' });
    // the intro is skipped by the resume: question two is on screen
    const first = radios(host)[0] as HTMLElement;

    for (const key of ['Enter', 'Tab', 'a', 'Home', 'End', 'PageDown']) {
      first.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key }));
    }
    await settle(fixture);

    expect(changes).toEqual([]);
  });

  // @traces 1359-FR-004
  it('keeps only the picked option checked after a re-pick', async () => {
    const { fixture, host } = await open({ mechanicsCount: '1-2' });
    const options = radios(host);

    options[2]?.click();
    await settle(fixture);
    options[1]?.click();
    await settle(fixture);

    expect(
      radios(host).map((radio) => radio.getAttribute('aria-checked')),
    ).toEqual(['false', 'true', 'false', 'false']);
  });

  // @traces 1359-FR-002
  it('asks for the form from the intro and no other screen', async () => {
    const { backs, fixture, host } = await open({});
    const back = host.querySelector('button.back') as HTMLButtonElement;

    back.click();
    await settle(fixture);

    expect(backs()).toBe(1);
  });

  // @traces 1359-FR-010
  it('does not offer the summary when a restored value holds a wrong code', async () => {
    const { host } = await open({
      ...FULL,
      liftsCount: '9',
    } as unknown as SurveySection);

    expect(host.querySelector('.summary')).toBeNull();
    expect(host.textContent).not.toContain('CREEAZĂ CONTUL');
  });
});
