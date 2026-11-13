// npm run dev: API + consola en una sola terminal (mision 8.2). Ctrl+C cierra las dos.
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { BACKEND, FRONTEND, bold, cyan, ensurePostgres, fail, killTree, magenta, startPrefixed } from './lib.mjs'

if (!existsSync(join(BACKEND, '.env')) || !existsSync(join(BACKEND, 'node_modules')) || !existsSync(join(FRONTEND, 'node_modules'))) {
  fail('El entorno no está preparado.', 'Corré primero: npm run setup')
}

await ensurePostgres()

console.log(`${bold('Gastronexo en desarrollo')}
  Consola:  ${cyan('http://localhost:5173')}
  API:      ${cyan('http://localhost:3000')}  (health: /health, base: /ready)
  Ctrl+C para cerrar todo.
`)

const children = [
  startPrefixed('api', magenta, 'npm', ['run', 'dev'], BACKEND),
  startPrefixed('web', cyan, 'npm', ['run', 'dev', '--', '--port', '5173', '--strictPort'], FRONTEND),
]

let closing = false
function shutdown(code = 0) {
  if (closing) return
  closing = true
  for (const child of children) killTree(child)
  setTimeout(() => process.exit(code), 300)
}

for (const child of children) {
  child.on('exit', (code) => {
    if (!closing) {
      console.error(`\nUn proceso terminó (código ${code}). Cerrando el resto.`)
      shutdown(code ?? 1)
    }
  })
}
process.on('SIGINT', () => shutdown(0))
process.on('SIGTERM', () => shutdown(0))
