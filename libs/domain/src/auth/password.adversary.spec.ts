import { DECOY_HASH, hashPassword, verifyPassword } from './password';

const salt = Buffer.alloc(16, 7).toString('base64').replace(/=+$/, '');
const tag = Buffer.alloc(32, 9).toString('base64').replace(/=+$/, '');
const phc = (params: string, s = salt, t = tag, version = 'v=19') =>
  `$argon2id$${version}$${params}$${s}$${t}`;

describe('password hashing under hostile input', () => {
  it('round-trips an empty-looking, a whitespace-only and a 1024-character password', async () => {
    for (const secret of [' ', '\t\n', 'x'.repeat(1024)]) {
      const stored = await hashPassword(secret);

      await expect(verifyPassword(secret, stored)).resolves.toBe(true);
      await expect(verifyPassword(`${secret}x`, stored)).resolves.toBe(false);
    }
  });

  it('round-trips unicode, emoji and a null byte, and keeps look-alikes apart', async () => {
    const secret = 'pă\u0000ss🔑ｗｏｒｄ';
    const stored = await hashPassword(secret);

    await expect(verifyPassword(secret, stored)).resolves.toBe(true);
    await expect(verifyPassword('pă', stored)).resolves.toBe(false);
    await expect(verifyPassword('pă\u0000ss🔑word', stored)).resolves.toBe(
      false,
    );
  });

  it('does not match a password that is only a prefix, a suffix or a case change', async () => {
    const stored = await hashPassword('Parola-De-Test');

    for (const attempt of [
      'Parola-De-Tes',
      'arola-De-Test',
      'parola-de-test',
    ]) {
      await expect(verifyPassword(attempt, stored)).resolves.toBe(false);
    }
  });

  it('hashes the same password to different strings that both verify', async () => {
    const [a, b] = await Promise.all([hashPassword('x'), hashPassword('x')]);

    expect(a).not.toBe(b);
    await expect(verifyPassword('x', a)).resolves.toBe(true);
    await expect(verifyPassword('x', b)).resolves.toBe(true);
  });

  it.each([
    ['an out-of-range memory cost', phc('m=4294967295,t=2,p=1')],
    ['a zero pass count', phc('m=19456,t=0,p=1')],
    ['a zero lane count', phc('m=19456,t=2,p=0')],
    ['a negative cost', phc('m=-1,t=2,p=1')],
    ['a missing version', `$argon2id$$m=19456,t=2,p=1$${salt}$${tag}`],
    ['an old version', phc('m=19456,t=2,p=1', salt, tag, 'v=16')],
    ['a salt shorter than eight bytes', phc('m=19456,t=2,p=1', 'AAAA')],
    ['an empty salt', phc('m=19456,t=2,p=1', '')],
    ['an empty tag', phc('m=19456,t=2,p=1', salt, '')],
    [
      'a tag with characters outside base64',
      phc('m=19456,t=2,p=1', salt, '!!!!'),
    ],
    ['trailing garbage', `${phc('m=19456,t=2,p=1')}$extra`],
    ['leading whitespace', ` ${phc('m=19456,t=2,p=1')}`],
    [
      'an upper-cased algorithm name',
      phc('m=19456,t=2,p=1').replace('argon2id', 'ARGON2ID'),
    ],
    ['a null byte', `${phc('m=19456,t=2,p=1')}\u0000`],
    ['argon2d', phc('m=19456,t=2,p=1').replace('argon2id', 'argon2d')],
  ])('answers false without throwing for a stored hash with %s', async (_, stored) => {
    await expect(verifyPassword('parola-de-test', stored)).resolves.toBe(false);
  });

  it('answers false for a stored hash of a million characters, without throwing', async () => {
    await expect(
      verifyPassword('x', `$argon2id$${'a'.repeat(1_000_000)}`),
    ).resolves.toBe(false);
  });

  it('keeps the decoy a hash that no password matches, empty or long, and that costs as much to check as a real one', async () => {
    for (const attempt of ['', ' ', 'x'.repeat(1024), 'parola-de-test']) {
      await expect(verifyPassword(attempt, DECOY_HASH)).resolves.toBe(false);
    }
    expect(DECOY_HASH).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
  });
});
