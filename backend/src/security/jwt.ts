import { createHmac, timingSafeEqual } from 'node:crypto';

export type JwtPayload = {
  sub: string;
  email: string;
  name: string;
  iss: string;
  iat: number;
  exp: number;
};

function base64UrlEncode(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64url');
}

function base64UrlEncodeJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

function base64UrlDecodeJson<T>(value: string): T {
  return JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as T;
}

function signInput(input: string, secret: string): string {
  return createHmac('sha256', secret).update(input).digest('base64url');
}

export function signJwt(
  secret: string,
  payload: Omit<JwtPayload, 'iat' | 'exp' | 'iss'>,
  issuer: string,
  expiresInSeconds: number
): string {
  const now = Math.floor(Date.now() / 1000);
  const tokenPayload: JwtPayload = {
    ...payload,
    iss: issuer,
    iat: now,
    exp: now + expiresInSeconds
  };

  const header = { alg: 'HS256', typ: 'JWT' };
  const signingInput = `${base64UrlEncodeJson(header)}.${base64UrlEncodeJson(tokenPayload)}`;
  const signature = signInput(signingInput, secret);

  return `${signingInput}.${signature}`;
}

export function verifyJwt(secret: string, token: string, expectedIssuer: string): JwtPayload {
  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new Error('Invalid token format');
  }

  const [encodedHeader, encodedPayload, signature] = parts;
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const expectedSignature = signInput(signingInput, secret);

  const signatureBuffer = Buffer.from(signature, 'base64url');
  const expectedBuffer = Buffer.from(expectedSignature, 'base64url');
  if (signatureBuffer.length !== expectedBuffer.length || !timingSafeEqual(signatureBuffer, expectedBuffer)) {
    throw new Error('Invalid token signature');
  }

  const header = base64UrlDecodeJson<{ alg: string; typ: string }>(encodedHeader);
  if (header.alg !== 'HS256' || header.typ !== 'JWT') {
    throw new Error('Unsupported token header');
  }

  const payload = base64UrlDecodeJson<JwtPayload>(encodedPayload);
  const now = Math.floor(Date.now() / 1000);

  if (payload.iss !== expectedIssuer) {
    throw new Error('Invalid token issuer');
  }

  if (payload.exp <= now) {
    throw new Error('Token expired');
  }

  return payload;
}
