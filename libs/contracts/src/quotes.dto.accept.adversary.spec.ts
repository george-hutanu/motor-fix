import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

import { AcceptQuoteDto } from './quotes.dto';

const options = {
  forbidNonWhitelisted: true,
  whitelist: true,
} as const;
const problems = (body: unknown) =>
  validateSync(plainToInstance(AcceptQuoteDto, body) as object, options).map(
    (e) => e.property,
  );

// @traces 222-FR-001
describe('AcceptQuoteDto under hostile input', () => {
  it.each([[{}], [{ historyShared: true }], [{ historyShared: false }]])(
    'takes %j',
    (body) => {
      expect(problems(body)).toEqual([]);
    },
  );

  it('takes an explicit undefined as absent', () => {
    expect(problems({ historyShared: undefined })).toEqual([]);
  });

  it.each([
    ['null', null],
    ['the string "true"', 'true'],
    ['the string "false"', 'false'],
    ['the number 1', 1],
    ['the number 0', 0],
    ['an empty string', ''],
    ['an array', [true]],
    ['an object', { value: true }],
    ['NaN', NaN],
  ])('refuses %s for historyShared', (_label, historyShared) => {
    expect(problems({ historyShared })).toEqual(['historyShared']);
  });

  it('refuses a field the body does not declare', () => {
    expect(problems({ extra: 1, historyShared: true })).toEqual(['extra']);
  });

  it.each(['history_shared', 'HistoryShared', 'bookingId', 'status'])(
    'refuses %s in place of historyShared',
    (field) => {
      expect(problems({ [field]: true })).toEqual([field]);
    },
  );

  it('refuses a prototype-polluting key without polluting', () => {
    const body = JSON.parse('{"__proto__":{"historyShared":"x"}}');
    expect(problems(body)).toEqual([]);
    expect(({} as { historyShared?: unknown }).historyShared).toBeUndefined();
  });

  it('leaves historyShared undefined when absent, for the service to default', () => {
    expect(plainToInstance(AcceptQuoteDto, {}).historyShared).toBeUndefined();
  });
});
