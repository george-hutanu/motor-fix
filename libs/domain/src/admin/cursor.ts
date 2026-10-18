const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// A keyset position in a list ordered by an instant, then by id. The caller
// maps a throw from decodeCursor to its own answer.
export const encodeCursor = (at: Date, id: string) =>
  Buffer.from(`${at.toISOString()}|${id}`).toString('base64url');

export function decodeCursor(cursor: string): { at: Date; id: string } {
  if (cursor.length > 200 || !/^[A-Za-z0-9_-]+$/.test(cursor)) {
    throw new Error('cursor is not base64url');
  }
  const parts = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
  if (parts.length !== 2) throw new Error('cursor is not two parts');
  const [text, id] = parts;
  const at = new Date(text);
  if (Number.isNaN(at.getTime()) || at.toISOString() !== text) {
    throw new Error('cursor holds no instant');
  }
  if (!UUID.test(id)) throw new Error('cursor holds no id');
  return { at, id };
}
