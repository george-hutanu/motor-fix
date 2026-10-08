import { randomUUID } from 'node:crypto';

import { serialDatabase } from '../../auth/serial-db.testing';
import {
  databaseUrl,
  fixtures,
} from '../../notifications/notifications.testing';

const { prisma, reset } = fixtures();
serialDatabase(databaseUrl);

let garageId: string;

beforeEach(async () => {
  await reset();
  ({ id: garageId } = await prisma.garage.create({
    data: { name: 'Service Auto Nord', slug: `nord-${randomUUID()}` },
  }));
});
afterAll(() => prisma.$disconnect());

const courtesyCar = (paid: boolean, price: number | null) =>
  prisma.$executeRaw`UPDATE garage SET courtesy_car_paid = ${paid}, courtesy_car_price_per_day_bani = ${price}::integer WHERE id = ${garageId}::uuid`;

const columns = async () => {
  const [row] = await prisma.$queryRaw<
    {
      cash: boolean;
      card: boolean;
      transfer: boolean;
      paid: boolean;
      price: number | null;
    }[]
  >`SELECT payment_cash AS cash, payment_card AS card, payment_transfer AS transfer,
      courtesy_car_paid AS paid, courtesy_car_price_per_day_bani AS price
    FROM garage WHERE id = ${garageId}::uuid`;
  return row;
};

describe("a garage's payment methods and courtesy car", () => {
  it('start with no payment method, no paid courtesy car and no price', async () => {
    expect(await columns()).toEqual({
      card: false,
      cash: false,
      paid: false,
      price: null,
      transfer: false,
    });
  });

  it.each([100, 12000, 200_000])(
    'keep a paid courtesy car at %i bani a day',
    async (price) => {
      await courtesyCar(true, price);

      expect(await columns()).toMatchObject({ paid: true, price });
    },
  );

  it('refuses a price without a paid courtesy car', async () => {
    await expect(courtesyCar(false, 12000)).rejects.toThrow(
      /garage_courtesy_price_with_paid/,
    );
  });

  it('refuses a paid courtesy car without a price', async () => {
    await expect(courtesyCar(true, null)).rejects.toThrow(
      /garage_courtesy_price_with_paid/,
    );
  });

  it.each([
    ['50 bani, under one leu', 50],
    ['200,100 bani, over the cap', 200_100],
    ['150 bani, not whole lei', 150],
  ])('refuses a price of %s', async (_, price) => {
    await expect(courtesyCar(true, price)).rejects.toThrow(
      /garage_courtesy_price_range/,
    );
  });
});
