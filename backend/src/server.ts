import { buildApp } from './app.js'
import { config } from './config.js'
import { pool } from './db/pool.js'

const app = buildApp()

async function start() {
  try {
    await pool.query('SELECT 1')
    await app.listen({ port: config.PORT, host: '0.0.0.0' })
  } catch (error) {
    app.log.error(error)
    process.exit(1)
  }
}

void start()
