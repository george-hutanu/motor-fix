import type { Template } from '../templates';

// As the driver cancels a booking: the garage's owners, receptionists and the
// booking's mechanic learn who, which car, which slot and why. The note is
// the bell's last segment and a line of the e-mail, left out when the driver
// wrote none, and never reaches the push (FR-006). Inside the free-cancel cutoff the late text adds
// that there is no penalty. No WhatsApp text: its names are not yet
// registered with Brevo.
const cancelled = (late: boolean): Template => ({
  audience: 'garage',
  bell: {
    en: '{driver} cancelled the booking · {car} · {slot} · {note}',
    ro: '{driver} a anulat programarea · {car} · {slot} · {note}',
  },
  email: {
    en: {
      button: { label: 'Open the requests', link: 'link' },
      lines: [
        '{driver} cancelled the booking for the {car} on {slot}.',
        'Reason: {reason}.',
        '{note}',
        ...(late
          ? ['Late cancellation (under 2 hours before), no penalty.']
          : []),
        'The slot is free again in your schedule.',
      ],
      reason:
        'You get this e‑mail because you work on bookings for your garage on MotorFix.',
      subject: 'Booking cancelled: {car}, {slot}',
    },
    ro: {
      button: { label: 'Deschide cererile', link: 'link' },
      lines: [
        '{driver} a anulat programarea pentru {car} din {slot}.',
        'Motivul: {reason}.',
        '{note}',
        ...(late
          ? ['Anulare târzie (sub 2 ore înainte), fără penalizare.']
          : []),
        'Intervalul este din nou liber în programul tău.',
      ],
      reason:
        'Primești acest e‑mail pentru că lucrezi cu programările service‑ului tău pe MotorFix.',
      subject: 'Programare anulată: {car}, {slot}',
    },
  },
  example: {
    car: 'Dacia Logan',
    driver: 'Andrei M.',
    link: 'https://motorfix.example/app/garage/requests',
    note: 'Am găsit un loc mai aproape',
    reason: 'plans_changed',
    slot: '2026-10-30T07:00:00.000Z',
  },
  push: {
    en: {
      body: '{driver} cancelled the booking · {car} · {slot}',
      link: 'link',
      shorten: 'driver',
      title: late ? 'Booking cancelled late' : 'Booking cancelled',
    },
    ro: {
      body: '{driver} a anulat programarea · {car} · {slot}',
      link: 'link',
      shorten: 'driver',
      title: late ? 'Programare anulată târziu' : 'Programare anulată',
    },
  },
  values: {
    car: 'text',
    driver: 'text',
    link: 'link',
    note: 'text',
    reason: 'cancel_reason',
    slot: 'when',
  },
});

export const BOOKING_CANCELLED_DRIVER = cancelled(false);
export const BOOKING_CANCELLED_DRIVER_LATE = cancelled(true);
