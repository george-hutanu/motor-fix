import { HttpException } from '@nestjs/common';

import { requireListedCourtesyCar } from './courtesy-car-guard';

const refusedWith = (run: () => void) => {
  try {
    run();
  } catch (error) {
    if (!(error instanceof HttpException)) throw error;
    return [error.getStatus(), error.getResponse()];
  }
  return null;
};

const NO_COURTESY_CAR = [
  400,
  expect.objectContaining({
    code: 'validation_failed',
    errors: [{ code: 'no_courtesy_car', field: 'courtesyCar' }],
  }),
];

describe('requireListedCourtesyCar under odd arguments', () => {
  // @traces 1248-FR-003
  it('refuses a listed car that is required and sent as undefined', () => {
    expect(
      refusedWith(() =>
        requireListedCourtesyCar(undefined, true, { required: true }),
      ),
    ).toEqual(NO_COURTESY_CAR);
  });

  // @traces 1248-FR-003
  it('takes an unlisted car with no terms even when required is set', () => {
    expect(
      refusedWith(() =>
        requireListedCourtesyCar(undefined, false, { required: true }),
      ),
    ).toBeNull();
  });

  // @traces 1248-FR-003
  it('takes no terms and no car with the options left out', () => {
    expect(
      refusedWith(() => requireListedCourtesyCar(undefined, false)),
    ).toBeNull();
  });

  // @traces 1248-FR-003
  it('refuses null terms for a car that is not listed', () => {
    expect(refusedWith(() => requireListedCourtesyCar(null, false))).toEqual(
      NO_COURTESY_CAR,
    );
  });

  // @traces 1248-FR-003
  it('refuses null terms for a listed car that needs them', () => {
    expect(
      refusedWith(() =>
        requireListedCourtesyCar(null, true, { required: true }),
      ),
    ).toEqual(NO_COURTESY_CAR);
  });

  // @traces 1248-FR-003
  it.each([0, '', false, {}])(
    'treats falsy-looking terms %p as sent and refuses them unlisted',
    (terms) => {
      expect(refusedWith(() => requireListedCourtesyCar(terms, false))).toEqual(
        NO_COURTESY_CAR,
      );
    },
  );

  // @traces 1248-FR-003
  it('gives the same refusal on every call', () => {
    const run = () => requireListedCourtesyCar({ paid: false }, false);
    expect(refusedWith(run)).toEqual(refusedWith(run));
  });
});
