import { z } from 'zod';

// A calendar day "2026-10-09" that exists: "2026-02-30" is refused.
export const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const at = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(at.getTime()) && at.toISOString().startsWith(value);
  });
