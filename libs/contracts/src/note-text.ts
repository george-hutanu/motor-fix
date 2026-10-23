// A note an admin writes: line breaks are the only control characters it
// may hold.
export const NOTE_TEXT = /^(?:[\t\n\r]|\P{Cc})*$/u;
