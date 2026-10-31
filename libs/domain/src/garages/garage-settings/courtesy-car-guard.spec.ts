import { HttpException } from '@nestjs/common';

import { requireListedCourtesyCar } from './courtesy-car-guard';

const refused = (run: () => void) => {
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

// @traces 1248-FR-003
describe('requireListedCourtesyCar', () => {
  it('refuses terms for a car the garage does not list', () => {
    expect(
      refused(() => requireListedCourtesyCar({ paid: false }, false)),
    ).toEqual(NO_COURTESY_CAR);
  });

  it('takes terms for a listed car', () => {
    expect(
      refused(() =>
        requireListedCourtesyCar({ paid: true, pricePerDayBani: 100 }, true),
      ),
    ).toBeNull();
  });

  it('takes no terms when they are not required', () => {
    expect(refused(() => requireListedCourtesyCar(undefined, true))).toBeNull();
    expect(
      refused(() => requireListedCourtesyCar(undefined, false)),
    ).toBeNull();
  });

  it('refuses a listed car sent without terms when they are required', () => {
    expect(
      refused(() =>
        requireListedCourtesyCar(undefined, true, { required: true }),
      ),
    ).toEqual(NO_COURTESY_CAR);
  });

  it('takes no terms for an unlisted car when they are required', () => {
    expect(
      refused(() =>
        requireListedCourtesyCar(undefined, false, { required: true }),
      ),
    ).toBeNull();
  });
});
