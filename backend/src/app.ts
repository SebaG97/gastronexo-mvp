import Fastify from 'fastify';
import type { Pool } from 'pg';

import { config } from './config.js';

export function buildApp(pool: Pool) {
  const app = Fastify({
    logger: {
      level: config.logLevel
    }
  });

  app.get('/health', async () => ({
    ok: true,
    uptime: process.uptime()
  }));

  app.get('/ready', async () => {
    await pool.query('SELECT 1');
    return {
      ok: true,
      database: 'ready'
    };
  });

  return app;
}
