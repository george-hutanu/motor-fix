// A note an admin writes: line breaks are the only control characters it
// may hold, and half of a surrogate pair, which the database refuses, none.
export const NOTE_TEXT = /^(?:[\t\n\r]|[^\p{Cc}\p{Cs}])*$/u;
