// The two Redis calls the clearing needs; an ioredis client has both.
export type KeyStore = {
  scan(
    cursor: string,
    match: 'MATCH',
    pattern: string,
    count: 'COUNT',
    size: number,
  ): Promise<[string, string[]]>;
  del(...keys: string[]): Promise<number>;
};

export async function clearSignUpCounts(_redis: KeyStore): Promise<number> {
  throw new Error('not implemented');
}

export function redisToClear(
  _env: Record<string, string | undefined>,
): string | null {
  throw new Error('not implemented');
}
