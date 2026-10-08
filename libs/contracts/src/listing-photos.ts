import type { ListingDraftData } from './listing-sections';

export const PHOTOS_MAX = 20;

// What the sending story asks of step 5's photos: one confirmed upload.
export const hasConfirmedPhoto = (data: ListingDraftData | undefined) =>
  (data?.files?.length ?? 0) >= 1;
