// @traces 244-FR-005 244-FR-009
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

import { ANALYTICS_CONSENT_VERSION } from './consent';
import { RecordConsentDto } from './consents.dto';

// As the API's ValidationPipe checks a body: unknown fields refused.
const failed = (body: Record<string, unknown>) =>
  validateSync(plainToInstance(RecordConsentDto, body), {
    forbidNonWhitelisted: true,
    whitelist: true,
  }).map((error) => error.property);

const valid = {
  at: '2026-10-10T09:30:00.000Z',
  browserConsentId: '0b9f3c1e-6a43-4c55-9d1c-6f3f1b7d2a10',
  decision: 'granted',
  language: 'ro',
  textVersion: ANALYTICS_CONSENT_VERSION,
};

describe('RecordConsentDto', () => {
  it.each(['granted', 'refused', 'withdrawn'])(
    'accepts a %s choice',
    (decision) => {
      expect(failed({ ...valid, decision })).toEqual([]);
    },
  );

  it.each([
    ['browserConsentId', 'not-a-uuid'],
    ['decision', 'maybe'],
    ['textVersion', '2026-01-01'],
    ['language', 'de'],
    ['at', 'yesterday'],
  ])('refuses %s %p', (field, value) => {
    expect(failed({ ...valid, [field]: value })).toEqual([field]);
  });

  it.each(['browserConsentId', 'decision', 'textVersion', 'language', 'at'])(
    'refuses a body without %s',
    (field) => {
      const body: Record<string, unknown> = { ...valid };
      delete body[field];
      expect(failed(body)).toEqual([field]);
    },
  );

  it('refuses an account named in the body', () => {
    expect(
      failed({ ...valid, accountId: '6d3b3a0e-2f8e-4b1f-8c2a-1d4e5f6a7b8c' }),
    ).toEqual(['accountId']);
  });
});
