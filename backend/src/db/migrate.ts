import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Pool, PoolClient } from 'pg';

import { config } from '../config.js';
import { createPool } from './pool.js';

async function loadMigrationFiles(migrationsDir: string): Promise<string[]> {
  const entries = await readdir(resolve(process.cwd(), migrationsDir), { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.sql'))
    .map((entry) => entry.name)
    .sort();
}

async function ensureMigrationsTable(pool: Pool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename text PRIMARY KEY,
      checksum text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);
}

async function acquireLock(client: PoolClient): Promise<void> {
  await client.query('SELECT pg_advisory_lock($1)', [917_200_002]);
}

async function releaseLock(client: PoolClient): Promise<void> {
  await client.query('SELECT pg_advisory_unlock($1)', [917_200_002]);
}

export async function runMigrations(pool: Pool): Promise<void> {
  await ensureMigrationsTable(pool);

  const client = await pool.connect();
  let lockAcquired = false;
  try {
    await acquireLock(client);
    lockAcquired = true;

    const migrationFiles = await loadMigrationFiles(config.migrationsDir);
    for (const filename of migrationFiles) {
      const filePath = resolve(process.cwd(), config.migrationsDir, filename);
      const sql = await readFile(filePath, 'utf8');
      const checksum = createHash('sha256').update(sql).digest('hex');

      const existing = await client.query<{ checksum: string }>(
        'SELECT checksum FROM schema_migrations WHERE filename = $1',
        [filename]
      );

      if (existing.rowCount === 1) {
        const appliedChecksum = existing.rows[0]?.checksum;
        if (appliedChecksum !== checksum) {
          throw new Error(`Migration file changed after being applied: ${filename}`);
        }
        continue;
      }

      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query(
          'INSERT INTO schema_migrations (filename, checksum) VALUES ($1, $2)',
          [filename, checksum]
        );
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }
  } finally {
    if (lockAcquired) {
      await releaseLock(client);
    }
    client.release();
  }
}

async function main(): Promise<void> {
  const pool = createPool();
  try {
    await runMigrations(pool);
  } finally {
    await pool.end();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
