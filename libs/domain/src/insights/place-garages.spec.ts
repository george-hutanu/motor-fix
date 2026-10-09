import { Logger } from '@nestjs/common';

import { placeGarages } from './place-garages';
import type { PrismaClient } from '../generated/prisma/client';
import type { PlacesProvider } from '../places/providers/places.provider';

const places: PlacesProvider = {
  name: 'fake',
  search: async () => ({ items: [{ label: 'x', lat: 0, lng: 0 }] }),
};

const database = (garage: object) => ({ garage }) as unknown as PrismaClient;

afterEach(() => jest.restoreAllMocks());

// The placing runs in the same job as the night's snapshot, so a database
// error while placing is logged and never stops the snapshot that follows.
describe('placeGarages when the database fails', () => {
  it('logs the failure and resolves when the garages cannot be read', async () => {
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    const db = database({
      findMany: async () => {
        throw new Error('connection lost');
      },
    });

    await expect(placeGarages(db, places)).resolves.toEqual({
      placed: 0,
      unplaced: 0,
    });
    expect(error).toHaveBeenCalledWith(
      'placing failed',
      expect.stringContaining('connection lost'),
    );
  });

  it('logs a thrown value that is not an error as text', async () => {
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    const db = database({
      findMany: async () => {
        throw 'socket closed';
      },
    });

    await expect(placeGarages(db, places)).resolves.toEqual({
      placed: 0,
      unplaced: 0,
    });
    expect(error).toHaveBeenCalledWith('placing failed', 'socket closed');
  });

  it('stops at the garage it could not save and resolves', async () => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation();
    const update = jest.fn(async () => {
      throw new Error('deadlock');
    });
    const db = database({
      findMany: async () => [
        { address: 'a', id: '1', seatAddress: null },
        { address: 'b', id: '2', seatAddress: null },
      ],
      update,
    });

    await expect(placeGarages(db, places)).resolves.toEqual({
      placed: 0,
      unplaced: 2,
    });
    expect(update).toHaveBeenCalledTimes(1);
  });
});
