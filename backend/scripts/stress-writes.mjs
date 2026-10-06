// Carga de escrituras mezcladas contra la API local, en una organizacion de prueba aislada.
// N escenarios en paralelo x R rondas por nivel, mientras se pollea /health y /ready.
// Al final corre check:consistency sobre toda la base.
//
// Uso: npm run stress:writes
// Variables: API_URL (default http://127.0.0.1:3000), STRESS_LEVELS (10,20,30), STRESS_ROUNDS (3),
// STRESS_REQUEST_TIMEOUT_MS (15000: una request mas lenta cuenta como colgada),
// STRESS_ALLOW_503=1 (aceptar 503 como resultado valido, p. ej. con un pool chico),
// PG_CONTAINER (gastronexo-postgres: para contar deadlocks en el log de PostgreSQL).
import 'dotenv/config'
import { spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { printConsistency, runConsistencyChecks } from './check-consistency.mjs'
import { assertLocalTarget, createApi, createRecorder, DEFAULT_API_URL, startProbes } from './lib/http.mjs'
import { createFixture, createProductWithoutBalance, scenarioCycle, scenarios } from './lib/stress-fixture.mjs'

/**
 * Cuenta deadlocks y lock timeouts en el log del contenedor de PostgreSQL desde `since`
 * (best effort: null si docker no esta disponible). PostgreSQL escribe su log en stderr.
 */
export function countDatabaseLockErrors(since, container = process.env.PG_CONTAINER ?? 'gastronexo-postgres') {
  const result = spawnSync('docker', ['logs', '--since', since.toISOString(), container], { encoding: 'utf8' })
  if (result.error || result.status !== 0) {
    return null
  }

  const output = `${result.stdout}${result.stderr}`
  return {
    deadlocks: (output.match(/deadlock detected/g) ?? []).length,
    lockTimeouts: (output.match(/lock timeout/g) ?? []).length,
  }
}

export async function runWritesStress({
  apiUrl = process.env.API_URL ?? DEFAULT_API_URL,
  levels = (process.env.STRESS_LEVELS ?? '10,20,30').split(',').map(Number),
  rounds = Number(process.env.STRESS_ROUNDS ?? 3),
  requestTimeoutMs = Number(process.env.STRESS_REQUEST_TIMEOUT_MS ?? 15000),
  allow503 = process.env.STRESS_ALLOW_503 === '1',
  checkConsistency = true,
  log = console.log,
} = {}) {
  assertLocalTarget(apiUrl)
  const api = createApi(apiUrl, { timeoutMs: requestTimeoutMs })

  const health = await api('GET', '/health', null, undefined, { timeoutMs: 2000 })
  if (health.status !== 200) {
    throw new Error(`La API no responde en ${apiUrl} (/health -> ${health.status}).`)
  }

  const startedAt = new Date(Date.now() - 1000)
  const ctx = await createFixture(api, 'stress')
  log(`Organizacion de prueba: ${ctx.organizationId}`)

  const recorder = createRecorder()
  const probes = startProbes(apiUrl, { intervalMs: 250, timeoutMs: 2000 })
  const runStartedAt = performance.now()

  for (const level of levels) {
    for (let round = 0; round < rounds; round += 1) {
      ctx.productWithoutBalance = await createProductWithoutBalance(api, ctx, `Sin balance N${level} R${round} ${ctx.stamp}`)
      const roundStartedAt = performance.now()
      await Promise.all(
        Array.from({ length: level }, (_, index) => {
          const scenario = scenarios[scenarioCycle[(index + round) % scenarioCycle.length]]
          return scenario(api, ctx, recorder.record, level * 1000 + round * 100 + index)
        }),
      )
      const totals = recorder.totals()
      log(
        `N=${level} ronda ${round + 1}/${rounds}: ${Math.round(performance.now() - roundStartedAt)} ms` +
          ` | acumulado ok=${totals.ok} 409=${totals.business} 503=${totals.unavailable} 5xx=${totals.serverError}` +
          ` colgadas=${totals.hung} inesperadas=${totals.unexpected}`,
      )
    }
  }

  const probeStats = await probes.stop()
  const elapsedMs = Math.round(performance.now() - runStartedAt)
  const totals = recorder.totals()

  log('\nResultados por operacion:')
  console.table(recorder.table())
  log('Probes (timeout 2 s):')
  console.table(probeStats)

  for (const [label, list] of Object.entries(recorder.samples)) {
    if (list.length) log(`Muestras ${label}: ${JSON.stringify(list).slice(0, 1500)}`)
  }

  let consistency = null
  if (checkConsistency) {
    consistency = await runConsistencyChecks()
    log('\ncheck:consistency (toda la base):')
    printConsistency(consistency)
  }

  const lockErrors = countDatabaseLockErrors(startedAt)
  log(
    lockErrors
      ? `\nPostgreSQL (log del contenedor): ${lockErrors.deadlocks} deadlocks detectados, ${lockErrors.lockTimeouts} lock timeouts`
      : '\nPostgreSQL: no se pudo leer el log del contenedor (docker no disponible).',
  )

  const failures = []
  if (totals.hung) failures.push(`${totals.hung} requests colgadas (> ${requestTimeoutMs} ms)`)
  if (totals.network) failures.push(`${totals.network} errores de red`)
  if (totals.serverError) failures.push(`${totals.serverError} respuestas 5xx distintas de 503`)
  if (totals.unexpected) failures.push(`${totals.unexpected} respuestas 4xx inesperadas`)
  if (!allow503 && totals.unavailable) failures.push(`${totals.unavailable} respuestas 503`)
  for (const name of ['health', 'ready']) {
    if (probeStats[name].noResponse) failures.push(`/${name} sin respuesta en 2 s (${probeStats[name].noResponse} veces)`)
  }
  if (probeStats.health.notOk) failures.push(`/health distinto de 200 (${probeStats.health.notOk} veces)`)
  if (!allow503 && probeStats.ready.notOk) failures.push(`/ready distinto de 200 (${probeStats.ready.notOk} veces)`)
  if (consistency && !consistency.ok) failures.push('check:consistency en rojo')

  log(`\nTotal: ${totals.total} requests de escritura en ${elapsedMs} ms (max ${totals.maxMs} ms por request).`)
  log(failures.length ? `RESULTADO: FALLA\n - ${failures.join('\n - ')}` : 'RESULTADO: OK')

  return { ok: failures.length === 0, failures, totals, probeStats, consistency, lockErrors, organizationId: ctx.organizationId }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await runWritesStress()
  process.exitCode = result.ok ? 0 : 1
}
