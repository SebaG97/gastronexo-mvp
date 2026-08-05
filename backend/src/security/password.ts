import { randomBytes, pbkdf2 as pbkdf2Callback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const pbkdf2 = promisify(pbkdf2Callback);
const iterations = 310_000;
const keyLength = 64;
const digest = 'sha512';

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('base64url');
  const derived = await pbkdf2(password, salt, iterations, keyLength, digest);
  return `pbkdf2$${digest}$${iterations}$${salt}$${Buffer.from(derived).toString('base64url')}`;
}

export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  const parts = storedHash.split('$');
  if (parts.length !== 5 || parts[0] !== 'pbkdf2') {
    throw new Error('Invalid password hash format');
  }

  const [, hashDigest, hashIterations, salt, expectedHash] = parts;
  const derived = await pbkdf2(password, salt, Number(hashIterations), keyLength, hashDigest);
  const actualBuffer = Buffer.from(derived);
  const expectedBuffer = Buffer.from(expectedHash, 'base64url');

  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}
