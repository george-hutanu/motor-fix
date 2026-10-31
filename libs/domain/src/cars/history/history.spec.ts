// @traces 061-FR-005
// @traces 061-FR-008
import { jobNames } from './history';

const quoted = (position: number, nameRo: string, nameEn: string) => ({
  requestJob: { jobType: { nameEn, nameRo }, position },
});

describe('the jobs a MotorFix repair names', () => {
  const jobs = [
    quoted(2, 'Discuri față', 'Front discs'),
    quoted(1, 'Plăcuțe față', 'Front pads'),
  ];

  it('joins them in Romanian by their asked order', () => {
    expect(jobNames(jobs, 'ro')).toBe('Plăcuțe față, Discuri față');
  });

  it('joins them in English for an English reader', () => {
    expect(jobNames(jobs, 'en')).toBe('Front pads, Front discs');
  });

  it('answers nothing when no quoted job is left, so the stored text is read', () => {
    expect(jobNames([], 'en')).toBe('');
  });
});
