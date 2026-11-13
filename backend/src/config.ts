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
  // Limites de intentos de autenticacion (mision 7.1).
  AUTH_LOGIN_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(1000).default(10),
  AUTH_LOGIN_WINDOW_MINUTES: z.coerce.number().int().min(1).max(1440).default(15),
  AUTH_REGISTER_MAX_PER_HOUR: z.coerce.number().int().min(1).max(10000).default(5),
  // Detras de un proxy/balanceador: true, un numero de saltos o una lista de IPs/CIDR.
  // Sin esto, el limite de intentos ve la IP del proxy y no la del cliente.
  TRUST_PROXY: z
    .string()
    .trim()
    .optional()
    .transform((value) => {
      if (!value || value === 'false') return false
      if (value === 'true') return true
      if (/^\d+$/.test(value)) return Number(value)
      return value
    }),
  // Avisos de pedidos nuevos (mision 7.4). Cada canal se activa si tiene sus credenciales.
  TELEGRAM_BOT_TOKEN: z.string().trim().min(20).optional(),
  TELEGRAM_API_BASE: z.string().url().default('https://api.telegram.org'),
  RESEND_API_KEY: z.string().trim().min(10).optional(),
  EMAIL_FROM: z.string().trim().min(3).optional(),
  EMAIL_API_BASE: z.string().url().default('https://api.resend.com'),
  // URL publica de la consola, para el link "Abrir en Gastronexo" de los avisos (opcional).
  PUBLIC_APP_URL: z.string().url().optional(),
  // Apagar el despachador (por ejemplo en un proceso que solo corre migraciones).
  NOTIFICATIONS_WORKER_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((value) => value === 'true'),
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

export const config = environmentSchema
  .superRefine((environment, context) => {
    // En produccion no se arranca con el secreto de ejemplo ni con uno trivial (mision 7.1).
    const secret = environment.JWT_SECRET
    const isPlaceholder = /replace-with|change-?me|example/i.test(secret)
    const distinctCharacters = new Set(secret).size
    if (environment.NODE_ENV === 'production' && (isPlaceholder || distinctCharacters < 10)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['JWT_SECRET'],
        message: 'JWT_SECRET de produccion debe ser aleatorio (por ejemplo: openssl rand -base64 48).',
      })
    }
  })
  .parse(process.env)
