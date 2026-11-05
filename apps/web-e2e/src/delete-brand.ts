import type { Client } from 'pg';

// PostgreSQL's SQLSTATEs for a row another table still points at:
// restrict_violation (search_log's key is ON DELETE RESTRICT) and
// foreign_key_violation (a NO ACTION key).
const STILL_REFERENCED = new Set(['23001', '23503']);

// Deletes a brand a spec made. A search writes its search_log row without
// waiting for it (SearchLogService), so a row can land after the spec's own
// DELETE of the brand's search_log: the brand is then still referenced, and
// its rows are cleared again before the next try.
export async function deleteBrand(
  db: Client,
  brandId: string,
  attempt = 1,
): Promise<void> {
  await db.query('DELETE FROM search_log WHERE brand_id = $1', [brandId]);
  try {
    await db.query('DELETE FROM brand WHERE id = $1', [brandId]);
  } catch (error) {
    const code = (error as { code?: string }).code ?? '';
    if (!STILL_REFERENCED.has(code) || attempt >= 5) throw error;
    await new Promise((resolve) => setTimeout(resolve, 200 * attempt));
    await deleteBrand(db, brandId, attempt + 1);
  }
}
