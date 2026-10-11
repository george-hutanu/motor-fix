import { FieldWatch, forStep, stepOfField } from './field-watch';

const check = {
  errors: [{ code: 'required', field: 'steps.1.name' }],
  warnings: [{ code: 'wide_range', field: 'steps.3.labour.to' }],
};
const quiet = { all: false, filled: false };

describe('FieldWatch', () => {
  // @traces 115-listing-checklist-FR-006
  it('shows an error once its field is left, and not before', () => {
    const watch = new FieldWatch();

    expect(watch.message(check, 'steps.1.name', quiet)).toBeNull();
    watch.leave('steps.1.name');
    expect(watch.message(check, 'steps.1.name', quiet)).toEqual({
      key: 'public.listing.details.nameLength',
      warning: false,
    });
  });

  // @traces 115-listing-checklist-FR-006
  it('shows a restored wrong value at once, but not while it is typed', () => {
    const watch = new FieldWatch();
    const filled = { all: false, filled: true };

    expect(watch.shows('steps.1.name', filled)).toBe(true);
    watch.type('steps.1.name');
    expect(watch.shows('steps.1.name', filled)).toBe(false);
    watch.leave('steps.1.name');
    watch.type('steps.1.name');
    expect(watch.shows('steps.1.name', filled)).toBe(true);
  });

  // @traces 115-listing-checklist-FR-008
  it('shows every error when sending is asked for', () => {
    const watch = new FieldWatch();
    watch.type('steps.1.name');

    expect(watch.shows('steps.1.name', { all: true, filled: true })).toBe(true);
  });

  // @traces 115-listing-checklist-FR-005
  it('tells a warning whatever the field state, and goes with the problem', () => {
    const watch = new FieldWatch();

    expect(watch.message(check, 'steps.3.labour.to', quiet)).toEqual({
      key: 'public.listing.prices.wideRange',
      warning: true,
    });
    watch.leave('steps.1.name');
    expect(
      watch.message({ errors: [], warnings: [] }, 'steps.1.name', quiet),
    ).toBeNull();
  });
});

describe('forStep', () => {
  // @traces 115-listing-checklist-FR-007
  it('keeps one step problems and drops a path no step holds', () => {
    const all = {
      errors: [
        { code: 'required', field: 'steps.1.name' },
        { code: 'required', field: 'files' },
        { code: 'required', field: 'steps.9.new' },
      ],
      warnings: [{ code: 'document_missing', field: 'documents.x' }],
    };

    expect(forStep(all, 5)).toEqual({
      errors: [{ code: 'required', field: 'files' }],
      warnings: [],
    });
    expect(forStep(all, 6).warnings).toHaveLength(1);
    expect(stepOfField('steps.9.new')).toBeNull();
  });
});
