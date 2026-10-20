import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { BrandChoice } from './brand-choice';

// @traces 228-FR-003
describe('BrandChoice.shown', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
  });

  it('holds no brand until Home shows one', () => {
    expect(TestBed.inject(BrandChoice).shown()).toBeNull();
  });

  it('holds the brand Home shows, and none once Home clears it', () => {
    const choice = TestBed.inject(BrandChoice);

    choice.shown.set('dacia');
    expect(choice.shown()).toBe('dacia');

    choice.shown.set(null);
    expect(choice.shown()).toBeNull();
  });
});
