import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// The published contract the web client is generated from.
const doc = JSON.parse(
  readFileSync(join(__dirname, '../openapi.json'), 'utf8'),
);

type Parameter = { in: string; name: string };

// The four toggle writes, each with the parameters it held before the key.
const writes: [string, string, string[]][] = [
  ['/api/v1/notification-preferences', 'put', []],
  ['/api/v1/notifications/{id}/read', 'post', ['id']],
  ['/api/v1/notifications/read-all', 'post', []],
  [
    '/api/v1/garages/{garageId}/prices/{priceId}',
    'patch',
    ['garageId', 'priceId'],
  ],
];

// @traces 1407-FR-001 1407-FR-002 1407-FR-003 1407-FR-004 1407-FR-005
describe('the toggle writes, in the OpenAPI document', () => {
  it.each(writes)(
    '%s %s takes an optional Idempotency-Key of 1 to 64 characters',
    (path, method) => {
      const parameters: Parameter[] =
        doc.paths[path]?.[method]?.parameters ?? [];
      const key = parameters.find((p) => p.name === 'Idempotency-Key');

      expect(key).toEqual({
        description: expect.stringMatching(/\S/),
        in: 'header',
        name: 'Idempotency-Key',
        required: false,
        schema: { maxLength: 64, minLength: 1, type: 'string' },
      });
    },
  );

  it.each(writes)(
    '%s %s keeps every other parameter it had',
    (path, method, before) => {
      const parameters: Parameter[] =
        doc.paths[path]?.[method]?.parameters ?? [];

      expect(
        parameters
          .filter((p) => p.name !== 'Idempotency-Key')
          .map((p) => p.name),
      ).toEqual(before);
    },
  );
});

// The generated client's four functions, in the order of `writes`.
const client = [
  'notifications/notification-preferences-controller-save.ts',
  'notifications/bell-controller-read.ts',
  'notifications/bell-controller-read-all.ts',
  'garages/price-list-controller-set-range.ts',
].map((file) => [file]);

// @traces 1407-FR-006
describe('the toggle writes, in the generated client', () => {
  it.each(client)(
    '%s takes an optional key and sends it as the header',
    (file) => {
      const source = readFileSync(
        join(__dirname, '../../../libs/data-access/src/lib/fn', file),
        'utf8',
      );

      expect(source).toContain("'Idempotency-Key'?: string;");
      expect(source).toContain(
        "rb.header('Idempotency-Key', params['Idempotency-Key'], {});",
      );
    },
  );
});
