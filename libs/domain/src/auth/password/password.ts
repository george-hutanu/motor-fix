import { argon2, randomBytes, timingSafeEqual } from 'node:crypto';

// OWASP's argon2id minimum: 19 MiB, 2 passes, 1 lane.
const MEMORY = 19456;
const PASSES = 2;
const LANES = 1;
const TAG = 32;

// Parameters are read back from each stored hash; these bounds keep a damaged
// or hostile row from asking for unbounded work.
const PHC =
  /^\$argon2id\$v=19\$m=(\d{1,6}),t=(\d{1,2}),p=(\d{1,2})\$([A-Za-z0-9+/]{11,64})\$([A-Za-z0-9+/]{22,88})$/;
const MAX_MEMORY = 262_144;

const b64 = (bytes: Buffer) => bytes.toString('base64').replace(/=+$/, '');

function derive(
  message: string,
  nonce: Buffer,
  memory: number,
  passes: number,
  parallelism: number,
  tagLength: number,
): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    argon2(
      'argon2id',
      { memory, message, nonce, parallelism, passes, tagLength },
      (error, tag) => (error ? reject(error) : resolve(tag)),
    ),
  );
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const tag = await derive(password, salt, MEMORY, PASSES, LANES, TAG);
  return `$argon2id$v=19$m=${MEMORY},t=${PASSES},p=${LANES}$${b64(salt)}$${b64(tag)}`;
}

export async function verifyPassword(
  password: string,
  phc: string,
): Promise<boolean> {
  const parts = PHC.exec(phc);
  if (!parts) return false;
  const [, m, t, p, salt, hash] = parts;
  const memory = Number(m);
  const expected = Buffer.from(hash ?? '', 'base64');
  if (memory > MAX_MEMORY || expected.length < 16) return false;
  try {
    const tag = await derive(
      password,
      Buffer.from(salt ?? '', 'base64'),
      memory,
      Number(t),
      Number(p),
      expected.length,
    );
    return timingSafeEqual(tag, expected);
  } catch {
    return false;
  }
}

// Checked when no account or no password exists, so that answer costs the
// same as a wrong password. No password derives this tag.
export const DECOY_HASH = `$argon2id$v=19$m=${MEMORY},t=${PASSES},p=${LANES}$${b64(Buffer.alloc(16, 1))}$${b64(Buffer.alloc(TAG))}`;
