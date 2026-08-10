import { config } from './config.js';
import { buildApp } from './app.js';
import { createPool } from './db/pool.js';
import { runMigrations } from './db/migrate.js';

async function main(): Promise<void> {
  const pool = createPool();
  const app = buildApp(pool);
  let shuttingDown = false;

  const shutdown = async (): Promise<void> => {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;
    await app.close();
    await pool.end();
  };

  const handleSignal = () => {
    void shutdown().catch((error) => {
      console.error(error);
    }).finally(() => {
      process.exit(0);
    });
  };

  process.once('SIGINT', handleSignal);
  process.once('SIGTERM', handleSignal);

  try {
    await runMigrations(pool);
    await app.listen({
      host: config.host,
      port: config.port
    });
  } catch (error) {
    await shutdown();
    throw error;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
