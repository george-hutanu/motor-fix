import type { Template } from '../templates';

// The link a seller sends the buyer of their car, with the car by brand and
// model (never its plate) and the days the link is valid. Sent straight by
// WhatsApp, in the seller's language, through a template approved per language.
export const CAR_TRANSFER_LINK: Template = {
  audience: 'any',
  example: {
    car: 'Dacia Logan',
    days: 7,
    link: 'https://motorfix.example/ro/transfer/abc',
  },
  values: { car: 'text', days: 'num', link: 'text' },
  whatsapp: {
    en: {
      name: 'motorfix_car_transfer_link_en',
      slots: ['{car}', '{link}', '{days}'],
    },
    ro: {
      name: 'motorfix_car_transfer_link_ro',
      slots: ['{car}', '{link}', '{days}'],
    },
  },
};
