import { audienceOf } from './audience';

// @traces 207-FR-008

const driver = 'd1';
const garage = 'g1';
const mechanic = 'm1';

describe('audienceOf', () => {
  it("sends a garage's brand change to its staff, its public page and each changed brand's search", () => {
    expect(
      audienceOf({
        brandIds: ['b1', 'b2'],
        garageId: garage,
        type: 'garage_brands',
      }),
    ).toEqual([
      'garage:g1',
      'public:garage:g1',
      'public:search:b1',
      'public:search:b2',
    ]);
  });

  it('sends a garage change to each garage it touches', () => {
    expect(audienceOf({ garageIds: ['g1', 'g2'], type: 'garage' })).toEqual([
      'garage:g1',
      'garage:g2',
    ]);
  });

  it('sends a request to its driver and to each garage it was sent to', () => {
    expect(
      audienceOf({
        driverAccountId: driver,
        garageIds: ['g1', 'g2'],
        type: 'request',
      }),
    ).toEqual(['account:d1', 'garage:g1', 'garage:g2']);
  });

  it('sends a quote to its driver and the quoting garage', () => {
    expect(
      audienceOf({ driverAccountId: driver, garageId: garage, type: 'quote' }),
    ).toEqual(['account:d1', 'garage:g1']);
  });

  it("sends a booking to its driver, the garage and the booking's mechanic", () => {
    expect(
      audienceOf({
        driverAccountId: driver,
        garageId: garage,
        mechanicId: mechanic,
        type: 'booking',
      }),
    ).toEqual(['account:d1', 'garage:g1', 'mechanic:m1']);
    expect(
      audienceOf({
        driverAccountId: driver,
        garageId: garage,
        mechanicId: null,
        type: 'booking',
      }),
    ).toEqual(['account:d1', 'garage:g1']);
  });

  it("sends a job to its driver, the garage and the job's mechanic, and no one else", () => {
    expect(
      audienceOf({
        driverAccountId: driver,
        garageId: garage,
        mechanicId: mechanic,
        type: 'job',
      }),
    ).toEqual(['account:d1', 'garage:g1', 'mechanic:m1']);
  });

  it("sends a review to the garage, its author, the garage's public page and its mechanic's public page", () => {
    expect(
      audienceOf({
        authorAccountId: driver,
        garageId: garage,
        mechanicId: mechanic,
        type: 'review',
      }),
    ).toEqual([
      'garage:g1',
      'account:d1',
      'public:garage:g1',
      'public:mechanic:m1',
    ]);
  });

  it('sends a review that names no mechanic to no mechanic page', () => {
    expect(
      audienceOf({
        authorAccountId: driver,
        garageId: garage,
        mechanicId: null,
        type: 'review',
      }),
    ).toEqual(['garage:g1', 'account:d1', 'public:garage:g1']);
  });

  it('sends a message to the driver and the garage', () => {
    expect(
      audienceOf({
        driverAccountId: driver,
        garageId: garage,
        type: 'message',
      }),
    ).toEqual(['account:d1', 'garage:g1']);
  });

  it("sends a car to its owner's account only", () => {
    expect(audienceOf({ ownerAccountId: driver, type: 'car' })).toEqual([
      'account:d1',
    ]);
  });

  it('sends a repair to its owner, and a shared repair also to the named garage', () => {
    expect(
      audienceOf({
        ownerAccountId: driver,
        sharedGarageId: null,
        type: 'repair',
      }),
    ).toEqual(['account:d1']);
    expect(
      audienceOf({
        ownerAccountId: driver,
        sharedGarageId: garage,
        type: 'repair',
      }),
    ).toEqual(['account:d1', 'garage:g1']);
  });

  it('sends verification and document events to the admins and the garage', () => {
    expect(audienceOf({ garageId: garage, type: 'verification' })).toEqual([
      'admin',
      'garage:g1',
    ]);
  });

  it("adds the garage's public page and the results channel when an approval publishes it", () => {
    expect(
      audienceOf({ garageId: garage, published: true, type: 'verification' }),
    ).toEqual(['admin', 'garage:g1', 'public:garage:g1', 'public:search']);
  });

  it("sends a garage's public change to its staff and its public page", () => {
    expect(
      audienceOf({ garageId: garage, results: false, type: 'public_garage' }),
    ).toEqual(['garage:g1', 'public:garage:g1']);
  });

  it('also sends a public change that can move the garage in results to the results channel', () => {
    expect(
      audienceOf({ garageId: garage, results: true, type: 'public_garage' }),
    ).toEqual(['garage:g1', 'public:garage:g1', 'public:search']);
  });

  it('sends platform rules and copy voices to the admins and the system channel', () => {
    expect(audienceOf({ type: 'platform' })).toEqual(['admin', 'system']);
  });

  it('keeps an admin-only platform change on the admin channel', () => {
    expect(audienceOf({ adminOnly: true, type: 'platform' })).toEqual([
      'admin',
    ]);
  });

  it('sends an account event to that account only', () => {
    expect(audienceOf({ accountId: driver, type: 'account' })).toEqual([
      'account:d1',
    ]);
  });

  it('puts no private subject on a public key', () => {
    const subjects = [
      { driverAccountId: driver, garageIds: [garage], type: 'request' },
      { driverAccountId: driver, garageId: garage, type: 'quote' },
      {
        driverAccountId: driver,
        garageId: garage,
        mechanicId: mechanic,
        type: 'booking',
      },
      {
        driverAccountId: driver,
        garageId: garage,
        mechanicId: mechanic,
        type: 'job',
      },
      { driverAccountId: driver, garageId: garage, type: 'message' },
      { ownerAccountId: driver, type: 'car' },
      { ownerAccountId: driver, sharedGarageId: garage, type: 'repair' },
    ] as const;

    for (const subject of subjects) {
      expect(audienceOf(subject).some((k) => k.startsWith('public:'))).toBe(
        false,
      );
    }
  });
});
