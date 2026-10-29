import { metrics } from '@opentelemetry/api';

// Looked up on every count: an instrument kept from before the meter provider
// is registered would stay a no-op for the life of the process.
const meter = () => metrics.getMeter('motorfix');

export function recordSend(outcome: 'sent' | 'open_request') {
  meter()
    .createCounter('motorfix_car_transfer_sends_total', {
      description: 'Car transfer sends, by whether the transfer was made',
    })
    .add(1, { outcome });
}

// `kind` is why the message did not leave, or none when it did.
export function recordWhatsApp(kind: string | null) {
  meter()
    .createCounter('motorfix_car_transfer_whatsapp_total', {
      description: 'Transfer links sent to the buyer on WhatsApp, by outcome',
    })
    .add(1, { kind: kind ?? 'none', outcome: kind ? 'failed' : 'sent' });
}

export function recordExpiries(count: number) {
  if (count === 0) return;
  meter()
    .createCounter('motorfix_car_transfer_expiries_total', {
      description: 'Sent car transfers the daily sweep expired',
    })
    .add(count);
}
