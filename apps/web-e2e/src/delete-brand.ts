import type { Client } from 'pg';

// PostgreSQL's SQLSTATE for a row another table still points at.
const STILL_REFERENCED = '23503';

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
    if ((error as { code?: string }).code !== STILL_REFERENCED || attempt >= 5)
      throw error;
    await new Promise((resolve) => setTimeout(resolve, 200 * attempt));
    await deleteBrand(db, brandId, attempt + 1);
  }
}
