import { z } from 'zod';

type UserTextAuthor = 'driver' | 'garage' | 'mechanic' | 'admin';

interface UserText {
  kind: 'user_text';
  author: UserTextAuthor;
  text: string;
}

// The one way a tool returns words another person wrote, so the assistant
// can tell them from the data it may act on.
export function userText(author: UserTextAuthor, text: string): UserText {
  return { author, kind: 'user_text', text };
}

// How a userText field reads in a tool's output schema.
export const userTextOutput = z.object({
  author: z.enum(['driver', 'garage', 'mechanic', 'admin']),
  kind: z.literal('user_text'),
  text: z.string(),
});
