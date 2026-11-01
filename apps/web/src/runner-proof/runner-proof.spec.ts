import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';

// The ahead-of-time compiler refuses both templates before any test runs, so
// each is compiled at run time, where the spec setup's own checks are tried.
// @traces 1332-angular-vitest-FR-006
@Component({ template: '' })
class UnknownElement {}

@Component({ template: '' })
class UnknownProperty {}

const double = vi.fn();

describe('the component spec setup', () => {
  // TestBed applies the environment's strict checks when a test module is
  // configured, as every component spec does.
  beforeEach(() => TestBed.configureTestingModule({}));

  it('refuses a template with an unknown element', () => {
    TestBed.overrideTemplate(UnknownElement, '<unknown-proof-element />');
    expect(() =>
      TestBed.createComponent(UnknownElement).detectChanges(),
    ).toThrow(/unknown-proof-element/);
  });

  it('refuses a template binding an unknown property', () => {
    TestBed.overrideTemplate(
      UnknownProperty,
      '<div [unknownProofProperty]="1"></div>',
    );
    expect(() =>
      TestBed.createComponent(UnknownProperty).detectChanges(),
    ).toThrow(/unknownProofProperty/);
  });

  it('records a call on a module-level double', () => {
    double('first');

    expect(double).toHaveBeenCalledTimes(1);
  });

  it('starts the next test with the double cleared', () => {
    expect(double).not.toHaveBeenCalled();
  });
});
