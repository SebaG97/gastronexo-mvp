// Copia los .sql de migraciones a dist/ (tsc no copia archivos que no son .ts), para que
// `npm run db:migrate:prod` funcione sin dependencias de desarrollo (mision 7.5).
import { cpSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const target = join(root, 'dist', 'db', 'migrations')
mkdirSync(target, { recursive: true })
cpSync(join(root, 'src', 'db', 'migrations'), target, { recursive: true })
console.info(`Migraciones copiadas a ${target}`)
