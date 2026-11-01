import * as choices from './search-choices';
import * as place from './search-place';

// search-place rides in the web page's first bundle (the home's brand search
// reads it); the filter choices only Results reads stay apart, so they land in
// its lazy chunk and the first page keeps under its 1 MB budget.
describe('the filter choices', () => {
  it('offer the four price ceilings and the three minimum ratings', () => {
    expect(choices.SEARCH_PRICE_CEILINGS).toEqual([150, 200, 250, 300]);
    expect(choices.SEARCH_MIN_RATINGS).toEqual(['3.5', '4.0', '4.5']);
  });

  it('are not part of search-place, which the first bundle carries', () => {
    expect(Object.keys(place)).not.toContain('SEARCH_PRICE_CEILINGS');
    expect(Object.keys(place)).not.toContain('SEARCH_MIN_RATINGS');
  });
});
