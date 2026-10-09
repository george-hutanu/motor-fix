import { z } from 'zod';

// A calendar day "2026-10-09" that exists: "2026-02-30" is refused.
export const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const at = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(at.getTime()) && at.toISOString().startsWith(value);
  });

// A booking as the schedule and the day sheet answer it: the car without its
// plate, the quoted jobs by name.
export const bookedOutput = {
  car: z.object({ brand: z.string(), model: z.string(), year: z.number() }),
  durationMinutes: z.number(),
  id: z.string(),
  jobs: z.array(z.string()),
  startsAt: z.string(),
  state: z.enum(['awaiting_confirmation', 'confirmed', 'completed', 'no_show']),
};
