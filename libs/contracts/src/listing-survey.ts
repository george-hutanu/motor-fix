// The sign-up survey as the draft holds it, one answer at a time, and the
// starting features its five answers set. Browser-safe: the page, the server's
// draft check and the garage's first write read the same rule.

export const MECHANICS_COUNTS = ['0', '1-2', '3-5', '6+'] as const;
export const LIFTS_COUNTS = ['0', '1', '2-3', '4+'] as const;
export const FOUND_VIA = [
  'google',
  'client',
  'garage',
  'social',
  'other',
] as const;
export const FEATURE_KEYS = [
  'team_mechanics',
  'lift_schedule',
  'live_media',
  'day_sheets',
  'whatsapp',
] as const;
type FeatureKey = (typeof FEATURE_KEYS)[number];

export interface SurveySection {
  mechanicsCount?: (typeof MECHANICS_COUNTS)[number];
  liftsCount?: (typeof LIFTS_COUNTS)[number];
  wantsLiveMedia?: boolean;
  wantsDaySheets?: boolean;
  foundVia?: (typeof FOUND_VIA)[number];
}
export type SurveyAnswers = Required<SurveySection>;

const RULES: Record<keyof SurveySection, (value: unknown) => boolean> = {
  foundVia: (value) => FOUND_VIA.some((code) => code === value),
  liftsCount: (value) => LIFTS_COUNTS.some((code) => code === value),
  mechanicsCount: (value) => MECHANICS_COUNTS.some((code) => code === value),
  wantsDaySheets: (value) => typeof value === 'boolean',
  wantsLiveMedia: (value) => typeof value === 'boolean',
};

export function isSurveySection(value: unknown): value is SurveySection {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.entries(value).every(
      ([key, answer]) =>
        Object.hasOwn(RULES, key) &&
        (answer === undefined || RULES[key as keyof SurveySection](answer)),
    )
  );
}

// Each of the five answers held by the section itself and in its codes: an
// inherited value would be lost when the answers are spread into a row.
export const surveyComplete = (
  section: SurveySection,
): section is SurveyAnswers =>
  Object.entries(RULES).every(
    ([key, rule]) =>
      Object.hasOwn(section, key) && rule(section[key as keyof SurveySection]),
  );

// WhatsApp starts on whatever the answers; the source sets nothing.
export const startingFeatures = (
  answers: SurveyAnswers,
): Record<FeatureKey, boolean> => ({
  day_sheets: answers.wantsDaySheets,
  lift_schedule: answers.liftsCount !== '0',
  live_media: answers.wantsLiveMedia,
  team_mechanics: answers.mechanicsCount !== '0',
  whatsapp: true,
});
