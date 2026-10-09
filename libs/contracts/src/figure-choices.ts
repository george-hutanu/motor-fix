// The admin figures' choices, free of decorators for the web app.

// `default` keeps each figure's own period; every other one ends today.
export const PERIODS = [
  'default',
  'today',
  '7d',
  '30d',
  'month',
  '12m',
] as const;
export type Period = (typeof PERIODS)[number];
// The whole country: every garage, a city known or not.
export const CITY_ALL = 'all';
export const CITY_KEY = /^[a-z0-9]+(-[a-z0-9]+)*$/;
