import { reportRefusalOf, textProblemOf } from './report';

const at = (iso: string) => new Date(iso);
const decided = (decidedAt: string, decision: 'kept' | 'removed' = 'kept') => ({
  decidedAt: at(decidedAt),
  decision,
});

// @traces 076-FR-007
describe('whether a review may be reported again', () => {
  it('refuses a reported review as already reported', () => {
    expect(reportRefusalOf({ editedAt: null, status: 'reported' }, null)).toBe(
      'already_reported',
    );
  });

  it('refuses a published review an admin kept and its author never edited', () => {
    expect(
      reportRefusalOf(
        { editedAt: null, status: 'published' },
        decided('2026-10-20T10:00:00Z'),
      ),
    ).toBe('already_kept');
  });

  it('refuses a review edited before the decision', () => {
    expect(
      reportRefusalOf(
        { editedAt: at('2026-10-19T10:00:00Z'), status: 'published' },
        decided('2026-10-20T10:00:00Z'),
      ),
    ).toBe('already_kept');
  });

  it('counts an edit at the very time of the decision as kept', () => {
    expect(
      reportRefusalOf(
        { editedAt: at('2026-10-20T10:00:00Z'), status: 'published' },
        decided('2026-10-20T10:00:00Z'),
      ),
    ).toBe('already_kept');
  });

  it('refuses a review removed and later restored, read from its rows alone', () => {
    expect(
      reportRefusalOf(
        { editedAt: null, status: 'published' },
        decided('2026-10-20T10:00:00Z', 'removed'),
      ),
    ).toBe('already_kept');
  });

  it('lets a review edited after the decision be reported', () => {
    expect(
      reportRefusalOf(
        { editedAt: at('2026-10-20T10:00:01Z'), status: 'published' },
        decided('2026-10-20T10:00:00Z'),
      ),
    ).toBeNull();
  });

  it('lets a published review with no decided report be reported', () => {
    expect(
      reportRefusalOf(
        { editedAt: at('2026-10-20T10:00:00Z'), status: 'published' },
        null,
      ),
    ).toBeNull();
  });
});

// @traces 076-FR-007
describe('the text a reason takes', () => {
  it('needs a text for something else', () => {
    expect(textProblemOf('other', undefined)).toBe('required');
    expect(textProblemOf('other', '   ')).toBe('required');
  });

  it('takes 1 to 500 characters for something else, counted after the trim', () => {
    expect(textProblemOf('other', 'x')).toBeNull();
    expect(textProblemOf('other', ` ${'ă'.repeat(500)} `)).toBeNull();
    expect(textProblemOf('other', '😀'.repeat(500))).toBeNull();
    expect(textProblemOf('other', 'ă'.repeat(501))).toBe('length');
  });

  it('refuses a text with any other reason', () => {
    expect(textProblemOf('insults', 'De ce?')).toBe('not_allowed');
  });

  it('takes no text with any other reason', () => {
    expect(textProblemOf('insults', undefined)).toBeNull();
  });
});
