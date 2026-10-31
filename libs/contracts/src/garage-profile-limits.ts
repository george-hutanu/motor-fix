// The owner's profile edit limits, shared by the API's checks and the
// dashboard's dialog; browser-safe, unlike the DTO that applies them.
export const PROFILE_DESCRIPTION_MAX = 1000;
export const PROFILE_RADIUS_KM = { max: 100, min: 5 } as const;
// A gallery photo's caption, in code points after trimming.
export const GARAGE_PHOTO_CAPTION_MAX = 80;
