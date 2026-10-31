import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

import { UpdateGarageProfileDto } from './garage-profile-update.dto';

const PAY = { card: false, cash: true, transfer: false };
const GROUP = { facilities: ['pickup_dropoff'], paymentMethods: PAY };

const failed = (facilities: unknown) =>
  validateSync(
    plainToInstance(UpdateGarageProfileDto, { facilities, version: '0' }),
    { forbidNonWhitelisted: true, whitelist: true },
  ).map((e) => e.property);

describe('the facilities group under hostile input', () => {
  // @traces 1248-FR-001
  it('takes the smallest whole group', () => {
    expect(failed(GROUP)).toEqual([]);
  });

  // @traces 1248-FR-001
  it('takes an empty facility list with a payment method', () => {
    expect(failed({ ...GROUP, facilities: [] })).toEqual([]);
  });

  // @traces 1248-FR-002
  it.each([null, 'pickup_dropoff', [], 7, true])(
    'refuses a group that is %p',
    (group) => {
      expect(failed(group)).toEqual(['facilities']);
    },
  );

  // @traces 1248-FR-002
  it('refuses a group without facilities', () => {
    expect(failed({ paymentMethods: PAY })).toEqual(['facilities']);
  });

  // @traces 1248-FR-002
  it('refuses a group without paymentMethods', () => {
    expect(failed({ facilities: [] })).toEqual(['facilities']);
  });

  // @traces 1248-FR-002
  it.each([null, 'pickup_dropoff', { 0: 'pickup_dropoff' }, 5])(
    'refuses facilities that are %p',
    (list) => {
      expect(failed({ ...GROUP, facilities: list })).toEqual(['facilities']);
    },
  );

  // @traces 1248-FR-002
  it.each([
    [['wifi']],
    [['pickup_dropoff', 'pickup_dropoff']],
    [['PICKUP_DROPOFF']],
    [[null]],
    [[1]],
    [['pickup_dropoff ']],
  ])('refuses the facility list %p', (list) => {
    expect(failed({ ...GROUP, facilities: list })).toEqual(['facilities']);
  });

  // @traces 1248-FR-002
  it('refuses an unknown key beside the group fields', () => {
    expect(failed({ ...GROUP, extra: 1 })).toEqual(['facilities']);
  });

  // @traces 1248-FR-002
  it('drops an own __proto__ key without touching any prototype', () => {
    const body = JSON.parse(
      '{"facilities":["waiting_area"],"paymentMethods":{"cash":true,"card":false,"transfer":false},"__proto__":{"x":1}}',
    );
    expect(failed(body)).toEqual([]);
    expect(({} as { x?: number }).x).toBeUndefined();
  });

  // @traces 1248-FR-002
  it.each([
    [{ card: false, cash: false, transfer: false }],
    [{}],
    [null],
    [[]],
    ['cash'],
    [{ card: false, cash: 'true', transfer: false }],
    [{ card: false, cash: 1, transfer: false }],
    [{ card: false, cash: true }],
    [{ card: false, cash: true, extra: true, transfer: false }],
  ])('refuses payment methods %p', (paymentMethods) => {
    expect(failed({ ...GROUP, paymentMethods })).toEqual(['facilities']);
  });

  // @traces 1248-FR-002
  it('accepts a payment mix of card and transfer only', () => {
    expect(
      failed({
        ...GROUP,
        paymentMethods: { card: true, cash: false, transfer: true },
      }),
    ).toEqual([]);
  });
});

describe('the note under hostile input', () => {
  // @traces 1248-FR-002
  it('takes a note of exactly 200 characters', () => {
    expect(failed({ ...GROUP, facilitiesNote: 'a'.repeat(200) })).toEqual([]);
  });

  // @traces 1248-FR-002
  it('refuses a note of 201 characters', () => {
    expect(failed({ ...GROUP, facilitiesNote: 'a'.repeat(201) })).toEqual([
      'facilities',
    ]);
  });

  // @traces 1248-FR-002
  it('counts 200 emoji as 200 characters', () => {
    expect(failed({ ...GROUP, facilitiesNote: '😀'.repeat(200) })).toEqual([]);
  });

  // @traces 1248-FR-002
  it('refuses 201 emoji', () => {
    expect(failed({ ...GROUP, facilitiesNote: '😀'.repeat(201) })).toEqual([
      'facilities',
    ]);
  });

  // @traces 1248-FR-002
  it('trims 200 letters padded with spaces before the limit', () => {
    expect(
      failed({ ...GROUP, facilitiesNote: `  ${'a'.repeat(200)}  ` }),
    ).toEqual([]);
  });

  // @traces 1248-FR-002
  it('takes the empty note and a blank one as no note', () => {
    expect(failed({ ...GROUP, facilitiesNote: '' })).toEqual([]);
    expect(failed({ ...GROUP, facilitiesNote: '   ' })).toEqual([]);
  });

  // @traces 1248-FR-002
  it.each(['a\nb', 'a\tb', 'a\u0000b', 'a\u001bb', 'a\u0085b', 'a\rb'])(
    'refuses a note holding the control character %j',
    (facilitiesNote) => {
      expect(failed({ ...GROUP, facilitiesNote })).toEqual(['facilities']);
    },
  );

  // @traces 1248-FR-002
  it.each(['a\u2028b', 'a\u2029b'])(
    "takes %j as the listing's note rule does (it refuses control characters only)",
    (facilitiesNote) => {
      expect(failed({ ...GROUP, facilitiesNote })).toEqual([]);
    },
  );

  // @traces 1248-FR-002
  it.each([null, 5, true, ['a'], { a: 1 }])(
    'refuses a note that is %p',
    (facilitiesNote) => {
      expect(failed({ ...GROUP, facilitiesNote })).toEqual(['facilities']);
    },
  );

  // @traces 1248-FR-002
  it('takes Romanian comma-below letters in the note', () => {
    expect(
      failed({ ...GROUP, facilitiesNote: 'Mașina se rezervă la ședință' }),
    ).toEqual([]);
  });
});

describe('the courtesy car under hostile input', () => {
  const withCar = (courtesyCar: unknown) =>
    failed({
      ...GROUP,
      courtesyCar,
      facilities: ['courtesy_car'],
    });

  // @traces 1248-FR-002
  it('takes a free car and a paid car at the price edges', () => {
    expect(withCar({ paid: false })).toEqual([]);
    expect(withCar({ paid: true, pricePerDayBani: 100 })).toEqual([]);
    expect(withCar({ paid: true, pricePerDayBani: 15_000 })).toEqual([]);
    expect(withCar({ paid: true, pricePerDayBani: 200_000 })).toEqual([]);
  });

  // @traces 1248-FR-002
  it.each([99, 0, -100, 200_100, 150, 100.5, 10_050, Number.NaN, 1e9])(
    'refuses a paid car at %p bani',
    (pricePerDayBani) => {
      expect(withCar({ paid: true, pricePerDayBani })).toEqual(['facilities']);
    },
  );

  // @traces 1248-FR-002
  it.each(['15000', null, true, [15_000], Number.POSITIVE_INFINITY])(
    'refuses a paid car priced %p',
    (pricePerDayBani) => {
      expect(withCar({ paid: true, pricePerDayBani })).toEqual(['facilities']);
    },
  );

  // @traces 1248-FR-002
  it('refuses a paid car without a price', () => {
    expect(withCar({ paid: true })).toEqual(['facilities']);
  });

  // @traces 1248-FR-002
  it.each([100, 0, null])('refuses a free car priced %p', (pricePerDayBani) => {
    expect(withCar({ paid: false, pricePerDayBani })).toEqual(['facilities']);
  });

  // @traces 1248-FR-002
  it.each([null, 'free', [], 7, {}, { paid: 'yes' }, { paid: 1 }])(
    'refuses courtesy car terms %p',
    (courtesyCar) => {
      expect(withCar(courtesyCar)).toEqual(['facilities']);
    },
  );

  // @traces 1248-FR-003
  it('leaves the pairing of terms and the ticked car to the use case', () => {
    expect(failed({ ...GROUP, courtesyCar: { paid: false } })).toEqual([]);
  });
});
