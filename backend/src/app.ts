import cors from '@fastify/cors';
import Fastify from 'fastify';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Pool } from 'pg';

import { config } from './config.js';
import { signJwt, verifyJwt } from './security/jwt.js';
import { hashPassword, verifyPassword } from './security/password.js';

type AuthBody = {
  email: string;
  password: string;
  name?: string;
};

type ProductBody = {
  name: string;
  sku?: string;
  unit?: string;
  stock?: number;
};

type UserRecord = {
  id: number;
  email: string;
  name: string;
  password_hash?: string;
};

type ProductRecord = {
  id: number;
  name: string;
  sku: string | null;
  unit: string;
  stock: number;
  created_at: Date;
  updated_at: Date;
};

type JwtUser = {
  id: number;
  email: string;
  name: string;
};

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function requireString(value: unknown, fieldName: string): string {
  if (typeof value !== 'string') {
    throw new Error(`${fieldName} is required`);
  }

  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`${fieldName} is required`);
  }

  return trimmed;
}

function requireOptionalString(value: unknown): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== 'string') {
    throw new Error('Invalid string value');
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function requireOptionalInteger(value: unknown, fieldName: string): number | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new Error(`${fieldName} must be a non-negative integer`);
  }

  return value;
}

function serializeUser(user: UserRecord): JwtUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name
  };
}

function serializeProduct(product: ProductRecord) {
  return {
    id: product.id,
    name: product.name,
    sku: product.sku,
    unit: product.unit,
    stock: product.stock,
    createdAt: product.created_at.toISOString(),
    updatedAt: product.updated_at.toISOString()
  };
}

function getBearerToken(request: FastifyRequest): string {
  const header = request.headers.authorization;
  if (!header) {
    throw new Error('Authorization header is required');
  }

  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) {
    throw new Error('Bearer token is required');
  }

  return token;
}

async function getAuthenticatedUser(request: FastifyRequest, reply: FastifyReply, pool: Pool): Promise<JwtUser | null> {
  try {
    const token = getBearerToken(request);
    const payload = verifyJwt(config.jwtSecret, token, config.jwtIssuer);
    const result = await pool.query<UserRecord>(
      'SELECT id, email, name FROM app_users WHERE id = $1',
      [Number(payload.sub)]
    );

    if (result.rowCount !== 1) {
      reply.code(401).send({ message: 'Session expired' });
      return null;
    }

    return serializeUser(result.rows[0]!);
  } catch (error) {
    reply.code(401).send({
      message: error instanceof Error ? error.message : 'Unauthorized'
    });
    return null;
  }
}

export function buildApp(pool: Pool) {
  const app = Fastify({
    logger: {
      level: config.logLevel
    }
  });

  void app.register(cors, {
    origin: config.corsOrigin,
    credentials: false
  });

  app.get('/health', async () => ({
    ok: true,
    uptime: process.uptime()
  }));

  app.get('/ready', async () => {
    await pool.query('SELECT 1');
    return {
      ok: true,
      database: 'connected'
    };
  });

  app.post<{ Body: AuthBody }>('/api/auth/register', async (request, reply) => {
    const name = requireString(request.body.name, 'name');
    const email = normalizeEmail(requireString(request.body.email, 'email'));
    const password = requireString(request.body.password, 'password');

    const existing = await pool.query(
      'SELECT id FROM app_users WHERE email = $1',
      [email]
    );

    if (existing.rowCount === 1) {
      return reply.code(409).send({ message: 'Email already registered' });
    }

    const passwordHash = await hashPassword(password);
    const result = await pool.query<UserRecord>(
      `INSERT INTO app_users (email, name, password_hash)
       VALUES ($1, $2, $3)
       RETURNING id, email, name`,
      [email, name, passwordHash]
    );

    const user = serializeUser(result.rows[0]!);
    const token = signJwt(
      config.jwtSecret,
      { sub: String(user.id), email: user.email, name: user.name },
      config.jwtIssuer,
      config.jwtExpiresInSeconds
    );

    return reply.code(201).send({ user, token });
  });

  app.post<{ Body: AuthBody }>('/api/auth/login', async (request, reply) => {
    const email = normalizeEmail(requireString(request.body.email, 'email'));
    const password = requireString(request.body.password, 'password');

    const result = await pool.query<UserRecord>(
      'SELECT id, email, name, password_hash FROM app_users WHERE email = $1',
      [email]
    );

    if (result.rowCount !== 1) {
      return reply.code(401).send({ message: 'Invalid credentials' });
    }

    const user = result.rows[0]!;
    const passwordMatches = await verifyPassword(password, user.password_hash!);
    if (!passwordMatches) {
      return reply.code(401).send({ message: 'Invalid credentials' });
    }

    const sessionUser = serializeUser(user);
    const token = signJwt(
      config.jwtSecret,
      { sub: String(sessionUser.id), email: sessionUser.email, name: sessionUser.name },
      config.jwtIssuer,
      config.jwtExpiresInSeconds
    );

    return reply.send({ user: sessionUser, token });
  });

  app.get('/api/auth/me', async (request, reply) => {
    const user = await getAuthenticatedUser(request, reply, pool);
    if (!user) {
      return;
    }

    return reply.send({ user });
  });

  app.get('/api/products', async (request, reply) => {
    const user = await getAuthenticatedUser(request, reply, pool);
    if (!user) {
      return;
    }

    const result = await pool.query<ProductRecord>(
      'SELECT id, name, sku, unit, stock, created_at, updated_at FROM app_products ORDER BY created_at DESC'
    );

    return reply.send({
      user,
      items: result.rows.map(serializeProduct)
    });
  });

  app.post<{ Body: ProductBody }>('/api/products', async (request, reply) => {
    const user = await getAuthenticatedUser(request, reply, pool);
    if (!user) {
      return;
    }

    const name = requireString(request.body.name, 'name');
    const sku = requireOptionalString(request.body.sku);
    const unit = requireOptionalString(request.body.unit) ?? 'unidad';
    const stock = requireOptionalInteger(request.body.stock, 'stock') ?? 0;

    const result = await pool.query<ProductRecord>(
      `INSERT INTO app_products (name, sku, unit, stock)
       VALUES ($1, $2, $3, $4)
       RETURNING id, name, sku, unit, stock, created_at, updated_at`,
      [name, sku ?? null, unit, stock]
    );

    return reply.code(201).send({
      item: serializeProduct(result.rows[0]!),
      user
    });
  });

  return app;
}
