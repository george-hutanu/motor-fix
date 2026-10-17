import { type Signal, signal } from '@angular/core';
import type {
  CarDto,
  SavedGarageItemDto,
  SavedGaragesPageDto,
} from '@motor-fix/data-access';

export const savedItem = (
  over: Partial<SavedGarageItemDto> = {},
): SavedGarageItemDto => ({
  available: true,
  brands: [{ id: 'brand-bmw', name: 'BMW' }],
  businessKind: 'company',
  garageId: 'garage-1',
  name: 'Auto Service Popescu',
  rating: 4.9,
  reviewCount: 31,
  savedAt: '2026-10-17T09:12:00.000Z',
  slug: 'auto-service-popescu',
  ...over,
});

// `count` saved garages, garage-1 the newest.
export const savedItems = (
  count: number,
  over: Partial<SavedGarageItemDto> = {},
) =>
  Array.from({ length: count }, (_, i) =>
    savedItem({
      garageId: `garage-${i + 1}`,
      name: `Service ${i + 1}`,
      slug: `service-${i + 1}`,
      ...over,
    }),
  );

export const pageOf = (
  items: SavedGarageItemDto[],
  {
    nextCursor = null,
    total = items.length,
    workingCount = items.filter((item) => item.brands.length).length,
  }: { nextCursor?: string | null; total?: number; workingCount?: number } = {},
): SavedGaragesPageDto => ({ items, nextCursor, total, workingCount });

export const savedCar = (over: Partial<CarDto> = {}): CarDto => ({
  brandId: 'brand-bmw',
  brandName: 'BMW',
  createdAt: '2026-10-07T09:00:00.000Z',
  engine: null,
  fuel: 'diesel',
  id: 'car-1',
  itpUntil: null,
  model: '320d',
  nextServiceKm: null,
  odometerKm: 120000,
  plate: null,
  rcaUntil: null,
  rovinietaUntil: null,
  updatedAt: '2026-10-07T09:00:00.000Z',
  year: 2017,
  ...over,
});

// ST-290's store as the list uses it: the ids it holds, and its removal.
export function fakeSavedGarages() {
  const ids = signal<ReadonlySet<string>>(new Set());
  return {
    ids,
    remove: jest.fn(async (garageId: string) => {
      ids.update((set) => {
        const next = new Set(set);
        next.delete(garageId);
        return next;
      });
    }),
    // What a failed removal or an undo does: the garage is saved again.
    restore: (garageId: string) =>
      ids.update((set) => new Set(set).add(garageId)),
  } satisfies { ids: Signal<ReadonlySet<string>>; [key: string]: unknown };
}
