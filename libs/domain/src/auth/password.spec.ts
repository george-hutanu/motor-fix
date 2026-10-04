import { DECOY_HASH, hashPassword, verifyPassword } from './password';

describe('password hashing', () => {
  it('stores argon2id in PHC form with its parameters', async () => {
    const phc = await hashPassword('parola-de-test');

    expect(phc).toMatch(
      /^\$argon2id\$v=19\$m=19456,t=2,p=1\$[A-Za-z0-9+/]{22}\$[A-Za-z0-9+/]{43}$/,
    );
  });

  it('salts every hash', async () => {
    expect(await hashPassword('same')).not.toBe(await hashPassword('same'));
  });

  it('accepts the right password and refuses a wrong one', async () => {
    const phc = await hashPassword('parola-de-test');

    await expect(verifyPassword('parola-de-test', phc)).resolves.toBe(true);
    await expect(verifyPassword('parola-de-Test', phc)).resolves.toBe(false);
    await expect(verifyPassword('', phc)).resolves.toBe(false);
  });

  it.each([
    ['empty', ''],
    ['not PHC', 'plain-text'],
    [
      'another algorithm',
      '$argon2i$v=19$m=19456,t=2,p=1$c2FsdHNhbHRzYWx0c2E$aGFzaA',
    ],
    ['broken parameters', '$argon2id$v=19$m=x,t=2,p=1$c2FsdA$aGFzaA'],
    ['a missing part', '$argon2id$v=19$m=19456,t=2,p=1$c2FsdA'],
  ])('refuses a stored hash that is %s, without throwing', async (_, phc) => {
    await expect(verifyPassword('anything', phc)).resolves.toBe(false);
  });

  it('keeps a decoy hash no password matches, for the no-account path', async () => {
    expect(DECOY_HASH).toMatch(/^\$argon2id\$/);
    await expect(verifyPassword('parola-de-test', DECOY_HASH)).resolves.toBe(
      false,
    );
  });

  it('honours the parameters written in the hash, not only the current ones', async () => {
    const { argon2Sync, randomBytes } = await import('node:crypto');
    const nonce = randomBytes(16);
    const tag = argon2Sync('argon2id', {
      memory: 8192,
      message: 'older',
      nonce,
      parallelism: 1,
      passes: 3,
      tagLength: 32,
    });
    const b64 = (b: Buffer) => b.toString('base64').replace(/=+$/, '');
    const phc = `$argon2id$v=19$m=8192,t=3,p=1$${b64(nonce)}$${b64(tag)}`;

    await expect(verifyPassword('older', phc)).resolves.toBe(true);
  });
});
