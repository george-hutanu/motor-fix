import { audienceOf } from './audience';

// @traces 1265-FR-008
describe('audienceOf a car transfer on odd input', () => {
  it('never reaches admin or a garage channel', () => {
    const keys = audienceOf({
      buyerAccountId: 'b',
      sellerAccountId: 's',
      type: 'car_transfer',
    });

    expect(keys.filter((key) => !key.startsWith('account:'))).toEqual([]);
  });

  it('keeps ids with colons inside one channel key each', () => {
    expect(
      audienceOf({
        buyerAccountId: 'b:admin',
        sellerAccountId: 's',
        type: 'car_transfer',
      }),
    ).toEqual(['account:s', 'account:b:admin']);
  });
});

// @traces 409-FR-012
describe('the audience of a repair under odd subjects', () => {
  it('is empty when there is no owner and no garage', () => {
    expect(
      audienceOf({
        ownerAccountId: null,
        sharedGarageId: null,
        type: 'repair',
      }),
    ).toEqual([]);
  });

  it('reaches the garage alone when the car has no owner', () => {
    expect(
      audienceOf({
        ownerAccountId: null,
        sharedGarageId: 'g1',
        type: 'repair',
      }),
    ).toEqual(['garage:g1']);
  });

  it('reaches the owner alone when no garage is named', () => {
    expect(
      audienceOf({
        ownerAccountId: 'a1',
        sharedGarageId: null,
        type: 'repair',
      }),
    ).toEqual(['account:a1']);
  });

  it('never reaches the admin, the public pages or another account', () => {
    const keys = audienceOf({
      ownerAccountId: 'a1',
      sharedGarageId: 'g1',
      type: 'repair',
    });
    expect(keys).toEqual(['account:a1', 'garage:g1']);
  });

  it('treats an empty-string owner as none', () => {
    expect(
      audienceOf({ ownerAccountId: '', sharedGarageId: 'g1', type: 'repair' }),
    ).toEqual(['garage:g1']);
  });

  it('answers the same on a second call', () => {
    const subject = {
      ownerAccountId: 'a1',
      sharedGarageId: 'g1',
      type: 'repair',
    } as const;
    expect(audienceOf(subject)).toEqual(audienceOf(subject));
  });

  it('does not let an id with a colon forge another channel prefix', () => {
    const keys = audienceOf({
      ownerAccountId: 'a1',
      sharedGarageId: 'x:y',
      type: 'repair',
    });
    expect(keys).toEqual(['account:a1', 'garage:x:y']);
  });
});
