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
})

export const config = environmentSchema.parse(process.env)
