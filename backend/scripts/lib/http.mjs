// Cliente HTTP minimo para los scripts de carga: timeout por request y clasificacion de respuestas.

export const DEFAULT_API_URL = 'http://127.0.0.1:3000'

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])

/** Los scripts crean datos: solo corren contra una API local salvo que se fuerce explicitamente. */
export function assertLocalTarget(apiUrl) {
  const { hostname } = new URL(apiUrl)
  if (!LOCAL_HOSTS.has(hostname) && process.env.STRESS_ALLOW_REMOTE !== '1') {
    throw new Error(`API_URL=${apiUrl} no es local. Estos scripts crean datos de prueba; usa STRESS_ALLOW_REMOTE=1 si es intencional.`)
  }
}

export function createApi(apiUrl, { timeoutMs }) {
  return async function api(method, path, token, body, options = {}) {
    const headers = { Accept: 'application/json' }
    if (token) headers.Authorization = `Bearer ${token}`
    if (body !== undefined) headers['Content-Type'] = 'application/json'

    const startedAt = performance.now()
    try {
      const response = await fetch(`${apiUrl}${path}`, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(options.timeoutMs ?? timeoutMs),
      })
      let data = null
      try {
        data = await response.json()
      } catch {
        data = null
      }
      return { status: response.status, data, ms: Math.round(performance.now() - startedAt) }
    } catch (error) {
      const status = error?.name === 'TimeoutError' ? 'TIMEOUT' : 'NETWORK'
      return { status, data: null, ms: Math.round(performance.now() - startedAt), error: String(error?.message ?? error) }
    }
  }
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Pollea /health y /ready en paralelo mientras corre la carga. Cada probe tiene su propio timeout:
 * una respuesta que no llega a tiempo cuenta como "sin respuesta".
 */
export function startProbes(apiUrl, { intervalMs = 250, timeoutMs = 2000 } = {}) {
  const api = createApi(apiUrl, { timeoutMs })
  const stats = {
    health: { total: 0, ok: 0, notOk: 0, noResponse: 0, maxMs: 0 },
    ready: { total: 0, ok: 0, notOk: 0, noResponse: 0, maxMs: 0 },
  }
  let running = true

  async function probe(name, path) {
    const response = await api('GET', path)
    const entry = stats[name]
    entry.total += 1
    entry.maxMs = Math.max(entry.maxMs, response.ms)
    if (typeof response.status !== 'number') entry.noResponse += 1
    else if (response.status === 200) entry.ok += 1
    else entry.notOk += 1
  }

  const loop = (async () => {
    while (running) {
      await Promise.all([probe('health', '/health'), probe('ready', '/ready'), sleep(intervalMs)])
    }
  })()

  return {
    async stop() {
      running = false
      await loop
      return stats
    },
  }
}

/** Acumula resultados por operacion y los clasifica. */
export function createRecorder() {
  const byOperation = new Map()
  const samples = { serverErrors: [], unexpected: [], unavailable: [] }

  function bucket(operation) {
    if (!byOperation.has(operation)) {
      byOperation.set(operation, {
        total: 0,
        ok: 0,
        business: 0,
        unavailable: 0,
        serverError: 0,
        hung: 0,
        network: 0,
        unexpected: 0,
        maxMs: 0,
        totalMs: 0,
      })
    }
    return byOperation.get(operation)
  }

  /**
   * Registra una respuesta. `allowed` son los 4xx de negocio esperables bajo contencion
   * (p. ej. 409 por stock insuficiente). Devuelve true si el escenario puede seguir.
   */
  function record(operation, response, { allowed = [409] } = {}) {
    const entry = bucket(operation)
    entry.total += 1
    entry.maxMs = Math.max(entry.maxMs, response.ms)
    entry.totalMs += response.ms

    if (response.status === 'TIMEOUT') {
      entry.hung += 1
      return false
    }
    if (response.status === 'NETWORK') {
      entry.network += 1
      return false
    }
    if (response.status >= 200 && response.status < 300) {
      entry.ok += 1
      return true
    }
    if (response.status === 503) {
      entry.unavailable += 1
      if (samples.unavailable.length < 5) samples.unavailable.push({ operation, body: response.data })
      return false
    }
    if (response.status >= 500) {
      entry.serverError += 1
      if (samples.serverErrors.length < 10) samples.serverErrors.push({ operation, status: response.status, body: response.data })
      return false
    }
    if (allowed.includes(response.status)) {
      entry.business += 1
      return false
    }
    entry.unexpected += 1
    if (samples.unexpected.length < 10) samples.unexpected.push({ operation, status: response.status, body: response.data })
    return false
  }

  function totals() {
    const sum = { total: 0, ok: 0, business: 0, unavailable: 0, serverError: 0, hung: 0, network: 0, unexpected: 0, maxMs: 0 }
    for (const entry of byOperation.values()) {
      for (const key of Object.keys(sum)) {
        sum[key] = key === 'maxMs' ? Math.max(sum.maxMs, entry.maxMs) : sum[key] + entry[key]
      }
    }
    return sum
  }

  function table() {
    return [...byOperation.entries()].map(([operation, entry]) => ({
      operation,
      total: entry.total,
      ok: entry.ok,
      '409/negocio': entry.business,
      '503': entry.unavailable,
      '5xx': entry.serverError,
      colgadas: entry.hung,
      red: entry.network,
      inesperadas: entry.unexpected,
      'prom ms': entry.total ? Math.round(entry.totalMs / entry.total) : 0,
      'max ms': entry.maxMs,
    }))
  }

  return { record, totals, table, samples }
}
