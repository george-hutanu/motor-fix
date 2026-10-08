export type UserTextAuthor = 'driver' | 'garage' | 'mechanic' | 'admin';

export interface UserText {
  kind: 'user_text';
  author: UserTextAuthor;
  text: string;
}

// The one way a tool returns words another person wrote, so the assistant
// can tell them from the data it may act on.
export function userText(author: UserTextAuthor, text: string): UserText {
  return { author, kind: 'user_text', text };
}
