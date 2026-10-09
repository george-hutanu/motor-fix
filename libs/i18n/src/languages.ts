export const LANGUAGES = ['ro', 'en'] as const;
export type Language = (typeof LANGUAGES)[number];

export const AREAS = [
  'shell',
  'public',
  'driver',
  'garage',
  'mechanic',
  'admin',
  'cockpit',
  'assistant',
] as const;
export type Area = (typeof AREAS)[number];

export const isLanguage = (value: string): value is Language =>
  (LANGUAGES as readonly string[]).includes(value);
