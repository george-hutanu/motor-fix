// A text as searches and duplicate checks read it: accents, case and format
// characters such as a zero-width space aside, so two names that show alike
// compare equal.
export const fold = (text: string) =>
  text
    .normalize('NFD')
    .replace(/[\p{M}\p{Cf}]/gu, '')
    .toLowerCase();
