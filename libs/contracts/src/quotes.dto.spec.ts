import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

import { AcceptQuoteDto } from './quotes.dto';

// @traces 222-FR-001

const problems = (body: object) =>
  validateSync(plainToInstance(AcceptQuoteDto, body), {
    forbidNonWhitelisted: true,
    whitelist: true,
  }).map((e) => e.property);

describe('AcceptQuoteDto', () => {
  it('takes an empty body: the history stays unshared', () => {
    expect(problems({})).toEqual([]);
  });

  it.each([true, false])('takes historyShared %s', (historyShared) => {
    expect(problems({ historyShared })).toEqual([]);
  });

  it.each([
    ['a string', 'true'],
    ['a number', 1],
    ['null', null],
    ['an object', {}],
  ])('refuses historyShared as %s, naming the field', (_, historyShared) => {
    expect(problems({ historyShared })).toEqual(['historyShared']);
  });

  it('refuses a field it does not know', () => {
    expect(problems({ price: 100 })).toEqual(['price']);
  });
});
