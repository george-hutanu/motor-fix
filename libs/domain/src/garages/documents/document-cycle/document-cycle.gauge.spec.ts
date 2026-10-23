import { countedMetrics, counterTotal } from '@motor-fix/observability/testing';

import { reportDocumentsOverdue } from './document-cycle.gauge';
import { countDocumentCycle } from '../../../metrics/product-counters';

// @traces 068-FR-016

const reader = countedMetrics();
const steps = (step: string) =>
  counterTotal(reader, 'motorfix_document_cycle_total', { step });
const overdue = () => counterTotal(reader, 'motorfix_documents_overdue');

describe('the yearly documents metrics', () => {
  it('counts each step of the cycle under its own label', async () => {
    countDocumentCycle('reminded_30');
    countDocumentCycle('reminded_30');
    countDocumentCycle('overdue');

    expect(await steps('reminded_30')).toBe(2);
    expect(await steps('overdue')).toBe(1);
    expect(await steps('reminded_7')).toBe(0);
  });

  it('reports the overdue cycles the latest run counted', async () => {
    expect(await overdue()).toBe(0);

    reportDocumentsOverdue(3);
    expect(await overdue()).toBe(3);

    reportDocumentsOverdue(1);
    expect(await overdue()).toBe(1);
  });
});
