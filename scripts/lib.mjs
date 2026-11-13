// Utilidades compartidas por setup, dev y demo (mision 8.2). Solo Node: funciona en Windows,
// macOS y Linux sin dependencias.
import { spawn, spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
export const BACKEND = join(ROOT, 'backend')
export const FRONTEND = join(ROOT, 'frontend')
export const CONTAINER = 'gastronexo-postgres'
export const isWindows = process.platform === 'win32'

const color = (code) => (text) => (process.stdout.isTTY ? `\x1b[${code}m${text}\x1b[0m` : text)
export const green = color(32)
export const yellow = color(33)
export const red = color(31)
export const cyan = color(36)
export const magenta = color(35)
export const bold = color(1)

export const step = (text) => console.log(`\n${bold('›')} ${text}`)
export const ok = (text) => console.log(`  ${green('✓')} ${text}`)
export const warn = (text) => console.log(`  ${yellow('!')} ${text}`)
export function fail(text, hint) {
  console.error(`\n  ${red('✗')} ${text}`)
  if (hint) console.error(`    ${hint}`)
  process.exit(1)
}

/** Ejecuta un comando mostrando su salida. Devuelve el codigo de salida. */
export function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', shell: isWindows, ...options })
  return result.status ?? 1
}

/** Ejecuta un comando y devuelve su salida, sin mostrarla. */
export function capture(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', shell: isWindows, ...options })
  return { status: result.status ?? 1, stdout: (result.stdout ?? '').trim(), stderr: (result.stderr ?? '').trim() }
}

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

export function dockerAvailable() {
  return capture('docker', ['info', '--format', '{{.ServerVersion}}']).status === 0
}

export function postgresHealth() {
  const result = capture('docker', ['inspect', '-f', '{{.State.Health.Status}}', CONTAINER])
  return result.status === 0 ? result.stdout : 'missing'
}

/** Levanta el contenedor de PostgreSQL si hace falta y espera a que este sano. */
export async function ensurePostgres() {
  if (!dockerAvailable()) {
    fail('Docker no está corriendo.', 'Abrí Docker Desktop, esperá a que diga "Engine running" y volvé a intentar.')
  }
  if (postgresHealth() !== 'healthy') {
    const status = run('docker', ['compose', 'up', '-d'], { cwd: ROOT })
    if (status !== 0) fail('No se pudo levantar PostgreSQL con docker compose.')
  }
  for (let i = 0; i < 60; i++) {
    const health = postgresHealth()
    if (health === 'healthy') return
    await sleep(1000)
  }
  fail('PostgreSQL no quedó listo en 60 s.', `Revisá: docker logs ${CONTAINER}`)
}

/** Proceso hijo con salida prefijada ("[api] ..."). */
export function startPrefixed(name, paint, command, args, cwd, env = {}) {
  // En macOS/Linux el hijo encabeza su propio grupo de procesos, para cerrarlo con sus nietos.
  const child = spawn(command, args, { cwd, shell: isWindows, detached: !isWindows, env: { ...process.env, ...env, FORCE_COLOR: '1' } })
  const prefix = paint(`[${name}]`)
  for (const stream of [child.stdout, child.stderr]) {
    let buffer = ''
    stream.on('data', (chunk) => {
      buffer += chunk.toString()
      const lines = buffer.split(/\r?\n/)
      buffer = lines.pop() ?? ''
      for (const line of lines) if (line.trim()) console.log(`${prefix} ${line}`)
    })
  }
  return child
}

/** Termina un proceso y sus hijos (en Windows `kill` no alcanza a los nietos de `npm`). */
export function killTree(child) {
  if (!child || child.exitCode !== null) return
  if (isWindows) spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
  else {
    try {
      process.kill(-child.pid, 'SIGTERM')
    } catch {
      child.kill('SIGTERM')
    }
  }
}
