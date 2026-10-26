import { replyRefusalOf, replyTextProblemOf } from './reply';

const LENGTH = { code: 'length', field: 'text' };

// @traces 075-FR-013
describe('the length of a reply', () => {
  it('takes a text of 1 to 1,000 characters after the trim', () => {
    expect(replyTextProblemOf('Mulțumim!')).toBeNull();
    expect(replyTextProblemOf(`  ${'a'.repeat(1000)}  `)).toBeNull();
  });

  it('refuses an empty or blank text', () => {
    expect(replyTextProblemOf('')).toEqual(LENGTH);
    expect(replyTextProblemOf(' \n\t ')).toEqual(LENGTH);
  });

  it('refuses 1,001 characters', () => {
    expect(replyTextProblemOf('a'.repeat(1001))).toEqual(LENGTH);
  });

  it('counts a character outside the basic plane once', () => {
    expect(replyTextProblemOf('🚗'.repeat(1000))).toBeNull();
    expect(replyTextProblemOf('🚗'.repeat(1001))).toEqual(LENGTH);
  });
});

const published = { status: 'published' } as const;
const reply = (status: 'published' | 'reported' | 'removed') => ({ status });

// @traces 075-FR-005
describe('whether the owner may post a reply', () => {
  it('lets her reply to a published review with no reply', () => {
    expect(replyRefusalOf(published, null, 'post')).toBeNull();
  });

  it.each(['reported', 'removed', 'deleted_by_author'] as const)(
    'refuses a %s review as not public',
    (status) => {
      expect(replyRefusalOf({ status }, null, 'post')).toBe(
        'review_not_public',
      );
      expect(replyRefusalOf({ status }, reply('removed'), 'post')).toBe(
        'review_not_public',
      );
    },
  );

  it('refuses a review whose reply an admin removed', () => {
    expect(replyRefusalOf(published, reply('removed'), 'post')).toBe(
      'reply_removed',
    );
  });

  it.each(['published', 'reported'] as const)(
    'refuses a second reply over a %s one',
    (status) => {
      expect(replyRefusalOf(published, reply(status), 'post')).toBe(
        'already_replied',
      );
    },
  );
});

// @traces 075-FR-005
describe('whether the owner may edit her reply', () => {
  it('lets her edit a published reply on a published review', () => {
    expect(replyRefusalOf(published, reply('published'), 'edit')).toBeNull();
  });

  it('refuses first a review that is not public', () => {
    expect(
      replyRefusalOf({ status: 'reported' }, reply('published'), 'edit'),
    ).toBe('review_not_public');
    expect(replyRefusalOf({ status: 'removed' }, null, 'edit')).toBe(
      'review_not_public',
    );
  });

  it('answers a review with no reply as not found', () => {
    expect(replyRefusalOf(published, null, 'edit')).toBe('not_found');
  });

  it('refuses a reported reply as not public', () => {
    expect(replyRefusalOf(published, reply('reported'), 'edit')).toBe(
      'reply_not_public',
    );
  });

  it('refuses a removed reply', () => {
    expect(replyRefusalOf(published, reply('removed'), 'edit')).toBe(
      'reply_removed',
    );
  });
});
