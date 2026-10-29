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
