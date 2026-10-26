import { createHash } from 'node:crypto';

import { type Language, text } from './errors';

const sorted = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(sorted);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sorted((value as Record<string, unknown>)[key])]),
  );
};

// The hex SHA-256 of the parsed arguments as key-sorted JSON: the same
// arguments in any key order hash the same.
export const argsHash = (input: unknown): string =>
  createHash('sha256')
    .update(JSON.stringify(sorted(input)))
    .digest('hex');

export function confirmationRequired(
  opened: { expiresAt: Date; id: string },
  tool: string,
  summary: string,
) {
  return {
    confirmationId: opened.id,
    expiresAt: opened.expiresAt.toISOString(),
    status: 'confirmation_required' as const,
    summary,
    tool,
  };
}

type NotSentReason = 'refused' | 'expired' | 'arguments_changed' | 'void';

export const notSent = (reason: NotSentReason, language: Language) => ({
  message: text(`not_sent_${reason}`, language),
  reason,
  status: 'not_sent' as const,
});
