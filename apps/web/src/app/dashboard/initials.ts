// The first character of the first and of the last word, as Romanian writes
// it upper-case; spread by code point, so an emoji or a letter outside the
// basic plane is never split.
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '';
  const first = (word: string) => [...word][0] ?? '';
  const letters =
    words.length === 1
      ? first(words[0] as string)
      : first(words[0] as string) + first(words.at(-1) as string);
  return letters.toLocaleUpperCase('ro');
}
