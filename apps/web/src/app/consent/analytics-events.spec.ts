import { ANALYTICS_EVENTS, sanitise } from './analytics-events';

// @traces 250-FR-004 250-FR-006
describe('the event contract', () => {
  it('holds exactly the launch events', () => {
    expect(Object.keys(ANALYTICS_EVENTS).sort()).toEqual(
      [
        'brand_picked',
        'filter_applied',
        'garage_opened',
        'garage_saved',
        'listing_started',
        'listing_step_completed',
        'listing_submitted',
        'message_sent',
        'quote_accepted',
        'quote_request_sent',
        'quote_request_started',
        'request_answered',
        'review_posted',
        'sign_up_completed',
        'survey_completed',
      ].sort(),
    );
  });

  it('knows an event not wired yet', () => {
    expect(sanitise('review_posted', { has_text: 'yes', rating: 5 })).toEqual({
      has_text: 'yes',
      rating: 5,
    });
    expect(sanitise('survey_completed', {})).toEqual({});
  });

  it('sends nothing for an unknown name', () => {
    expect(sanitise('page_left', { source: 'home' })).toBeNull();
    expect(sanitise('toString', {})).toBeNull();
  });
});

// @traces 250-FR-002
describe('the properties an event keeps', () => {
  it('keeps every allowed property and value', () => {
    expect(
      sanitise('sign_up_completed', { method: 'phone', role: 'driver' }),
    ).toEqual({ method: 'phone', role: 'driver' });
    expect(
      sanitise('brand_picked', {
        brand: 'mercedes-benz',
        source: 'home_picker',
      }),
    ).toEqual({ brand: 'mercedes-benz', source: 'home_picker' });
  });

  it('drops a property outside the set and still sends the event', () => {
    expect(
      sanitise('garage_opened', {
        garage: '6d3b3a0e-2f8e-4b1f-8c2a-1d4e5f6a7b8c',
        source: 'results',
      }),
    ).toEqual({ source: 'results' });
    expect(sanitise('listing_started', { draft: 'abc' })).toEqual({});
  });

  it('drops a value outside its allowed values', () => {
    expect(sanitise('garage_opened', { source: 'newsletter' })).toEqual({});
    expect(sanitise('request_answered', { action: 'QUOTE' })).toEqual({});
  });

  it.each([
    ['Dacia'],
    ['dacia logan'],
    ['dacia--logan'],
    ['-dacia'],
    ['dacia-'],
    ['ana@motorfix.ro'],
    ['b-123-abc '],
    ['a'.repeat(81)],
    [7],
  ])('drops the brand %p', (brand) => {
    expect(sanitise('brand_picked', { brand, source: 'home_picker' })).toEqual({
      source: 'home_picker',
    });
  });

  it('keeps a brand of 80 characters', () => {
    const brand = 'a'.repeat(80);
    expect(sanitise('quote_request_sent', { brand })).toEqual({ brand });
  });

  it('keeps job counts and positions that are whole numbers from 1', () => {
    expect(sanitise('quote_request_sent', { jobs: 1 })).toEqual({ jobs: 1 });
    expect(sanitise('quote_request_sent', { jobs: 12 })).toEqual({ jobs: 12 });
    expect(sanitise('quote_accepted', { position: 3, sort: 'price' })).toEqual({
      position: 3,
      sort: 'price',
    });
    for (const bad of [0, -1, 1.5, '2', Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(sanitise('quote_request_sent', { jobs: bad })).toEqual({});
      expect(sanitise('quote_accepted', { position: bad })).toEqual({});
    }
  });

  it('keeps a step from 1 to 6 and a rating from 1 to 5', () => {
    expect(sanitise('listing_step_completed', { step: 1 })).toEqual({
      step: 1,
    });
    expect(sanitise('listing_step_completed', { step: 6 })).toEqual({
      step: 6,
    });
    expect(sanitise('review_posted', { rating: 1 })).toEqual({ rating: 1 });
    expect(sanitise('review_posted', { rating: 5 })).toEqual({ rating: 5 });
    for (const step of [0, 7, 2.5, '3'])
      expect(sanitise('listing_step_completed', { step })).toEqual({});
    for (const rating of [0, 6, 4.5, '5'])
      expect(sanitise('review_posted', { rating })).toEqual({});
  });

  it('keeps only the three garage buckets, written with an en dash', () => {
    for (const garages of ['1', '2–3', '4–5'])
      expect(sanitise('quote_request_sent', { garages })).toEqual({ garages });
    for (const garages of ['2-3', '4-5', '2', 3, '6'])
      expect(sanitise('quote_request_sent', { garages })).toEqual({});
  });

  it('lets no name, e-mail, phone, plate, id or free text through', () => {
    expect(
      sanitise('quote_request_sent', {
        brand: 'Ana Popescu',
        email: 'ana@motorfix.ro',
        garages: '2–3',
        jobs: 1,
        message: 'Zgomot la frânare, vă rog sunați',
        phone: '+40712345678',
        plate: 'B-123-ABC',
        requestId: '0b9f3c1e-6a43-4c55-9d1c-6f3f1b7d2a10',
      }),
    ).toEqual({ garages: '2–3', jobs: 1 });
    expect(
      sanitise('sign_up_completed', {
        accountId: '0b9f3c1e-6a43-4c55-9d1c-6f3f1b7d2a10',
        method: 'ana@motorfix.ro',
        role: 'driver',
      }),
    ).toEqual({ role: 'driver' });
  });
});
