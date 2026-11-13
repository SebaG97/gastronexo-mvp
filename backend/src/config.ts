import 'dotenv/config'
import { z } from 'zod'

const environmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().url(),
  JWT_SECRET: z.string().min(32),
  JWT_EXPIRES_IN: z
    .string()
    .trim()
    .regex(/^\d+(s|m|h|d)$/i, 'JWT_EXPIRES_IN debe usar formato como 15m, 8h o 7d.'),
  FRONTEND_ORIGIN: z.string().url().default('http://localhost:5173'),
  // Origen de la tienda publica si se sirve desde otro dominio (opcional).
  STOREFRONT_ORIGIN: z.string().url().optional(),
  // Pool de conexiones de la API.
  DB_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
  DB_POOL_CONNECTION_TIMEOUT_MS: z.coerce.number().int().min(50).max(60000).default(3000),
  DB_POOL_IDLE_TIMEOUT_MS: z.coerce.number().int().min(1000).max(600000).default(30000),
  // Protecciones de sesion en PostgreSQL (milisegundos).
  DB_STATEMENT_TIMEOUT_MS: z.coerce.number().int().min(100).max(600000).default(15000),
  DB_LOCK_TIMEOUT_MS: z.coerce.number().int().min(100).max(600000).default(5000),
  DB_IDLE_IN_TRANSACTION_TIMEOUT_MS: z.coerce.number().int().min(1000).max(600000).default(15000),
  // /ready: conexion propia con timeout corto, independiente del pool de la API.
  DB_READY_TIMEOUT_MS: z.coerce.number().int().min(100).max(10000).default(1000),
})

export const config = environmentSchema.parse(process.env)
