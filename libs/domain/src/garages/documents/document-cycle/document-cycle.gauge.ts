import { metrics } from '@opentelemetry/api';

let overdue: number | undefined;
let observed = false;

// Reports `count` as motorfix_documents_overdue until the next compliance
// run reports again. The gauge is made on the first report, once the meter
// provider is surely registered.
export function reportDocumentsOverdue(count: number) {
  overdue = count;
  if (observed) return;
  observed = true;
  metrics
    .getMeter('motorfix')
    .createObservableGauge('motorfix_documents_overdue', {
      description: 'Yearly document cycles overdue, as the last run counted',
    })
    .addCallback((result) => {
      if (overdue !== undefined) result.observe(overdue);
    });
}
