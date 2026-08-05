import dotenv from 'dotenv';

dotenv.config();

type NodeEnv = 'development' | 'test' | 'production';
type LogLevel = 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent';

function parsePort(value: string | undefined): number {
  const fallback = 8080;
  if (!value) {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    throw new Error(`Invalid PORT value: ${value}`);
  }

  return parsed;
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) {
    return fallback;
  }

  if (value === 'true') {
    return true;
  }

  if (value === 'false') {
    return false;
  }

  throw new Error(`Invalid boolean value: ${value}`);
}

function parseNodeEnv(value: string | undefined): NodeEnv {
  if (!value) {
    return 'development';
  }

  if (value === 'development' || value === 'test' || value === 'production') {
    return value;
  }

  throw new Error(`Invalid NODE_ENV value: ${value}`);
}

function parseLogLevel(value: string | undefined): LogLevel {
  const fallback: LogLevel = 'info';
  if (!value) {
    return fallback;
  }

  const allowed: LogLevel[] = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'];
  if (allowed.includes(value as LogLevel)) {
    return value as LogLevel;
  }

  throw new Error(`Invalid LOG_LEVEL value: ${value}`);
}

const nodeEnv = parseNodeEnv(process.env.NODE_ENV);
const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error('DATABASE_URL is required');
}

export const config = {
  nodeEnv,
  host: process.env.HOST ?? '0.0.0.0',
  port: parsePort(process.env.PORT),
  logLevel: parseLogLevel(process.env.LOG_LEVEL),
  databaseUrl,
  databaseSsl: parseBoolean(process.env.DATABASE_SSL, nodeEnv === 'production'),
  migrationsDir: process.env.MIGRATIONS_DIR ?? 'src/db/migrations'
} as const;
