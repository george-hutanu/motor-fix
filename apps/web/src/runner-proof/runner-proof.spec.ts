import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';

// @traces 1332-angular-vitest-FR-006
@Component({ template: '<unknown-proof-element />' })
class UnknownElement {}

@Component({ template: '<div [unknownProofProperty]="1"></div>' })
class UnknownProperty {}

const double = vi.fn();

describe('the component spec setup', () => {
  it('refuses a template with an unknown element', () => {
    expect(() => TestBed.createComponent(UnknownElement)).toThrow(
      /unknown-proof-element/,
    );
  });

  it('refuses a template binding an unknown property', () => {
    expect(() => TestBed.createComponent(UnknownProperty)).toThrow(
      /unknownProofProperty/,
    );
  });

  it('records a call on a module-level double', () => {
    double('first');

    expect(double).toHaveBeenCalledTimes(1);
  });

  it('starts the next test with the double cleared', () => {
    expect(double).not.toHaveBeenCalled();
  });
});
