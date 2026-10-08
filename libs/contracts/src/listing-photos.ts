import type { ListingDraftData } from './listing-drafts.dto';

export const PHOTOS_MAX = 20;

// What the sending story asks of step 5's photos: one confirmed upload.
export const hasConfirmedPhoto = (data: ListingDraftData | undefined) =>
  (data?.files?.length ?? 0) >= 1;
