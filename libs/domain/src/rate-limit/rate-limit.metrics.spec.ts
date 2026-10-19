import { countedMetrics, counterTotal } from '@motor-fix/observability/testing';

import { countRateLimitRefusal } from './rate-limit.metrics';

// @traces 1181-FR-008
describe('the rate-limit refusal count', () => {
  const reader = countedMetrics();
  const refusals = (route: string) =>
    counterTotal(reader, 'motorfix_rate_limit_refusals_total', { route });

  it('counts each refusal under its route only', async () => {
    const before = await refusals('POST /mcp');

    countRateLimitRefusal('POST /mcp');
    countRateLimitRefusal('POST /mcp');

    expect(await refusals('POST /mcp')).toBe(before + 2);
    expect(await refusals('GET /api/v1/search/garages')).toBe(0);
  });
});
