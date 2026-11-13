// npm run setup: deja el entorno local listo desde cero (mision 8.2). Repetible: lo que ya
// esta hecho no se toca (en particular, nunca sobrescribe un .env existente).
import { randomBytes } from 'node:crypto'
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { BACKEND, FRONTEND, bold, cyan, ensurePostgres, fail, ok, run, step, warn } from './lib.mjs'

// Debe coincidir con docker-compose.yml.
const LOCAL_DATABASE_URL = 'postgresql://gastronexo:gastronexo-dev@localhost:5432/gastronexo_dev'

step('Node.js')
const major = Number(process.versions.node.split('.')[0])
if (major < 20) fail(`Node ${process.versions.node} es muy viejo.`, 'Instalá Node 22 LTS desde https://nodejs.org')
if (major !== 22) warn(`Node ${process.versions.node}: el proyecto usa Node 22 (producción). Debería funcionar, pero conviene 22 LTS.`)
else ok(`Node ${process.versions.node}`)

step('PostgreSQL en Docker')
await ensurePostgres()
ok('PostgreSQL listo (contenedor gastronexo-postgres)')

step('Variables de entorno')
const backendEnv = join(BACKEND, '.env')
if (existsSync(backendEnv)) {
  ok('backend/.env ya existe: no se modifica')
  const content = readFileSync(backendEnv, 'utf8')
  if (!/^DATABASE_URL=/m.test(content)) warn('backend/.env no tiene DATABASE_URL. Revisalo contra backend/.env.example.')
} else {
  const template = readFileSync(join(BACKEND, '.env.example'), 'utf8')
  const content = template
    .replace(/^DATABASE_URL=.*$/m, `DATABASE_URL=${LOCAL_DATABASE_URL}`)
    .replace(/^JWT_SECRET=.*$/m, `JWT_SECRET=${randomBytes(36).toString('base64')}`)
  writeFileSync(backendEnv, content)
  ok('backend/.env creado (base local de Docker y JWT_SECRET aleatorio)')
}
const frontendEnv = join(FRONTEND, '.env')
if (existsSync(frontendEnv)) ok('frontend/.env ya existe: no se modifica')
else {
  copyFileSync(join(FRONTEND, '.env.example'), frontendEnv)
  ok('frontend/.env creado')
}

step('Dependencias')
for (const [name, dir] of [
  ['backend', BACKEND],
  ['frontend', FRONTEND],
]) {
  if (run('npm', ['install', '--no-audit', '--no-fund'], { cwd: dir }) !== 0) fail(`npm install falló en ${name}.`)
  ok(`${name}: dependencias instaladas`)
}

step('Migraciones')
if (run('npm', ['run', 'db:migrate'], { cwd: BACKEND }) !== 0) fail('Las migraciones fallaron.', 'Revisá el error de arriba y DATABASE_URL en backend/.env.')
ok('Base de datos al día')

console.log(`
${bold('Listo.')} Ahora:

  ${cyan('npm run dev')}    levanta la API (http://localhost:3000) y la consola (http://localhost:5173)
  ${cyan('npm run demo')}   (con dev corriendo) crea una cuenta demo con tienda, productos y stock
`)
