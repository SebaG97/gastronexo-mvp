// Simulacion de agotamiento del pool: levanta una API propia con DB_POOL_MAX=2 en otro puerto,
// dispara 30 escenarios de escritura en paralelo y verifica que todo termine rapido (exito,
// 409 de negocio o 503), sin colgarse, con /health y /ready respondiendo y que la API se recupere.
//
// Fase A: timeout de conexion por defecto. Fase B: timeout de conexion de 100 ms para forzar 503.
// Uso: npm run stress:exhaustion   (no necesita la API corriendo; usa la base de backend/.env)
// Variables: EXHAUSTION_PORT (3199), EXHAUSTION_PARALLEL (30).
import 'dotenv/config'
import { spawn } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { printConsistency, runConsistencyChecks } from './check-consistency.mjs'
import { createApi, createRecorder, sleep, startProbes } from './lib/http.mjs'
import { createFixture, createProductWithoutBalance, scenarioCycle, scenarios } from './lib/stress-fixture.mjs'

const backendDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const port = Number(process.env.EXHAUSTION_PORT ?? 3199)
const parallel = Number(process.env.EXHAUSTION_PARALLEL ?? 30)
const apiUrl = `http://127.0.0.1:${port}`
const requestTimeoutMs = 15000

async function startApi(extraEnv) {
  const child = spawn(process.execPath, ['--import', 'tsx', 'src/server.ts'], {
    cwd: backendDir,
    env: { ...process.env, PORT: String(port), ...extraEnv },
    stdio: ['ignore', 'ignore', 'pipe'],
  })
  let stderr = ''
  child.stderr.on('data', (chunk) => {
    stderr += chunk
  })

  const api = createApi(apiUrl, { timeoutMs: 1000 })
  const deadline = Date.now() + 30000
  while (Date.now() < deadline) {
    if (child.exitCode !== null) break
    const health = await api('GET', '/health')
    if (health.status === 200) return child
    await sleep(300)
  }

  child.kill()
  throw new Error(`La API de prueba no levanto en ${apiUrl}. ${stderr.slice(-800)}`)
}

async function stopApi(child) {
  if (child.exitCode !== null) return
  const exited = new Promise((resolvePromise) => child.once('exit', resolvePromise))
  child.kill()
  await Promise.race([exited, sleep(5000)])
}

async function runPhase(name, extraEnv) {
  console.log(`\n=== ${name} (${Object.entries(extraEnv).map(([key, value]) => `${key}=${value}`).join(' ')}) ===`)
  const child = await startApi(extraEnv)
  try {
    const api = createApi(apiUrl, { timeoutMs: requestTimeoutMs })
    const ctx = await createFixture(api, 'exhaust')
    ctx.productWithoutBalance = await createProductWithoutBalance(api, ctx, `Sin balance ${ctx.stamp}`)

    const recorder = createRecorder()
    const probes = startProbes(apiUrl, { intervalMs: 100, timeoutMs: 2000 })
    const startedAt = performance.now()
    await Promise.all(
      Array.from({ length: parallel }, (_, index) =>
        scenarios[scenarioCycle[index % scenarioCycle.length]](api, ctx, recorder.record, index),
      ),
    )
    const burstMs = Math.round(performance.now() - startedAt)

    // Recuperacion: sin carga, la API vuelve a aceptar escrituras y /ready vuelve a 200.
    const recoveryStartedAt = performance.now()
    let recovered = false
    while (performance.now() - recoveryStartedAt < 10000) {
      const ready = await api('GET', '/ready', null, undefined, { timeoutMs: 2000 })
      const write = await api('POST', '/api/customers', ctx.token, { name: `Recuperacion ${Date.now()}` }, { timeoutMs: 2000 })
      if (ready.status === 200 && write.status === 201) {
        recovered = true
        break
      }
      await sleep(200)
    }
    const recoveryMs = Math.round(performance.now() - recoveryStartedAt)
    const probeStats = await probes.stop()
    const totals = recorder.totals()

    console.table(recorder.table())
    console.table(probeStats)
    if (recorder.samples.unavailable.length) console.log(`Ejemplo 503: ${JSON.stringify(recorder.samples.unavailable[0])}`)
    if (recorder.samples.serverErrors.length) console.log(`Ejemplos 5xx: ${JSON.stringify(recorder.samples.serverErrors)}`)
    if (recorder.samples.unexpected.length) console.log(`Ejemplos inesperados: ${JSON.stringify(recorder.samples.unexpected)}`)

    const failures = []
    if (totals.hung) failures.push(`${totals.hung} requests colgadas (> ${requestTimeoutMs} ms)`)
    if (totals.network) failures.push(`${totals.network} errores de red`)
    if (totals.serverError) failures.push(`${totals.serverError} respuestas 5xx distintas de 503`)
    if (totals.unexpected) failures.push(`${totals.unexpected} respuestas 4xx inesperadas`)
    for (const probe of ['health', 'ready']) {
      if (probeStats[probe].noResponse) failures.push(`/${probe} sin respuesta en 2 s (${probeStats[probe].noResponse} veces)`)
    }
    if (probeStats.health.notOk) failures.push(`/health distinto de 200 (${probeStats.health.notOk} veces)`)
    if (!recovered) failures.push('la API no se recupero en 10 s')

    console.log(
      `${parallel} escenarios en ${burstMs} ms: ok=${totals.ok} 409=${totals.business} 503=${totals.unavailable}` +
        ` 5xx=${totals.serverError} colgadas=${totals.hung}; max ${totals.maxMs} ms por request;` +
        ` /ready 503=${probeStats.ready.notOk}; recuperacion en ${recoveryMs} ms`,
    )
    console.log(failures.length ? `${name}: FALLA\n - ${failures.join('\n - ')}` : `${name}: OK`)
    return failures.length === 0
  } finally {
    await stopApi(child)
  }
}

const phaseA = await runPhase('Fase A: pool de 2 conexiones', { DB_POOL_MAX: '2' })
const phaseB = await runPhase('Fase B: pool de 2 y timeout de conexion de 100 ms', {
  DB_POOL_MAX: '2',
  DB_POOL_CONNECTION_TIMEOUT_MS: '100',
})

const consistency = await runConsistencyChecks()
console.log('\ncheck:consistency (toda la base):')
printConsistency(consistency)

const ok = phaseA && phaseB && consistency.ok
console.log(ok ? '\nRESULTADO: OK' : '\nRESULTADO: FALLA')
process.exitCode = ok ? 0 : 1
