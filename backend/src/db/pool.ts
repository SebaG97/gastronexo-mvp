import { Pool } from 'pg';

import { config } from '../config.js';

export function createPool(): Pool {
  return new Pool({
    connectionString: config.databaseUrl,
    ssl: config.databaseSsl ? { rejectUnauthorized: false } : false
  });
}
