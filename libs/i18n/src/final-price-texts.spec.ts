import { readFileSync } from 'node:fs';
import { join } from 'node:path';

type Language = 'ro' | 'en';

// Read from the files, not through I18n.t, which falls back to Romanian and
// would hide a text missing in English.
const problems = (language: Language): Record<string, string> =>
  JSON.parse(
    readFileSync(join(__dirname, 'garage', `${language}.json`), 'utf8'),
  ).jobs.problem;

// The refusals of the handover and the correction, in the words the spec
// gives them, for the garage's screens to show by code.
// @traces 406-FR-002 406-FR-005
describe('the final price refusals', () => {
  it.each([
    ['ro', 'job_not_done', 'Marchează întâi lucrarea ca gata'],
    ['en', 'job_not_done', 'Mark the job as done first'],
    ['ro', 'correction_window_closed', 'Prețul final nu mai poate fi corectat'],
    [
      'en',
      'correction_window_closed',
      'The final price can no longer be corrected',
    ],
  ] as const)('%s %s reads as the spec gives it', (language, code, text) => {
    expect(problems(language)[code]).toBe(text);
  });
});
