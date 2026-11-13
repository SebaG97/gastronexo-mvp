import { useCallback, useEffect, useRef, useState } from 'react'
import { getOrders, type Order } from '../../shared/lib/auth-api'

// Mision 7.3: avisos de pedidos nuevos de la tienda en la consola.
// Cada cuanto se consulta. Con la pestaña en segundo plano el navegador puede espaciarlo
// (Chrome lo lleva a ~1 por minuto tras unos minutos oculta); al volver se consulta enseguida.
const POLL_MS = 20_000
// Pedidos nuevos que se miran por consulta para detectar cuales no se habian visto.
const WINDOW_SIZE = 20
const PREFERENCE_KEY = 'gastronexo.orderAlerts'

export type OrderAlert = {
  /** Pedidos detectados en esta tanda (el primero es el mas reciente). */
  orders: Order[]
  /** Cuantos pedidos nuevos entraron; puede ser mayor que orders.length en una rafaga. */
  count: number
  detectedAt: number
}

export type NotificationState = 'unsupported' | 'default' | 'granted' | 'denied'

function readPreference() {
  try {
    return window.localStorage.getItem(PREFERENCE_KEY) !== 'off'
  } catch {
    return true
  }
}

function writePreference(enabled: boolean) {
  try {
    window.localStorage.setItem(PREFERENCE_KEY, enabled ? 'on' : 'off')
  } catch {
    // Sin almacenamiento (modo privado): la preferencia dura lo que la pestaña.
  }
}

function currentNotificationState(): NotificationState {
  return typeof window !== 'undefined' && 'Notification' in window ? Notification.permission : 'unsupported'
}

/** Dos tonos cortos generados con Web Audio: no hace falta un archivo de sonido. */
function playChime(context: AudioContext | null) {
  if (!context) return
  try {
    if (context.state === 'suspended') void context.resume()
    const start = context.currentTime
    for (const [offset, frequency] of [
      [0, 880],
      [0.18, 1320],
    ] as const) {
      const oscillator = context.createOscillator()
      const gain = context.createGain()
      oscillator.type = 'sine'
      oscillator.frequency.value = frequency
      gain.gain.setValueAtTime(0.0001, start + offset)
      gain.gain.exponentialRampToValueAtTime(0.25, start + offset + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, start + offset + 0.32)
      oscillator.connect(gain).connect(context.destination)
      oscillator.start(start + offset)
      oscillator.stop(start + offset + 0.35)
    }
  } catch {
    // Audio bloqueado por el navegador: el aviso visual sigue funcionando.
  }
}

export function useStorefrontOrderAlerts(token: string | undefined, organizationId: string | undefined) {
  const [count, setCount] = useState(0)
  const [alert, setAlert] = useState<OrderAlert | null>(null)
  const [enabled, setEnabled] = useState(readPreference)
  const [notificationState, setNotificationState] = useState<NotificationState>(currentNotificationState)
  // Se incrementa cada vez que entran pedidos nuevos: Pedidos lo usa para recargar la lista.
  const [arrivalTick, setArrivalTick] = useState(0)

  const seenIdsRef = useRef<Set<string> | null>(null)
  const lastTotalRef = useRef(0)
  const audioRef = useRef<AudioContext | null>(null)
  const enabledRef = useRef(enabled)
  enabledRef.current = enabled

  const ensureAudio = useCallback(() => {
    if (audioRef.current || typeof window === 'undefined') return
    const AudioContextClass =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (AudioContextClass) {
      try {
        audioRef.current = new AudioContextClass()
      } catch {
        audioRef.current = null
      }
    }
  }, [])

  // Los navegadores solo habilitan audio despues de una interaccion: se prepara en el primer click.
  useEffect(() => {
    const unlock = () => {
      ensureAudio()
      if (audioRef.current?.state === 'suspended') void audioRef.current.resume()
    }
    window.addEventListener('pointerdown', unlock, { once: true })
    window.addEventListener('keydown', unlock, { once: true })
    return () => {
      window.removeEventListener('pointerdown', unlock)
      window.removeEventListener('keydown', unlock)
    }
  }, [ensureAudio])

  // Al cambiar de sesion u organizacion se empieza de cero (sin avisar lo que ya estaba).
  useEffect(() => {
    seenIdsRef.current = null
    lastTotalRef.current = 0
    setAlert(null)
    setCount(0)
  }, [token, organizationId])

  useEffect(() => {
    if (!token) return
    let cancelled = false
    let inFlight = false

    const check = async () => {
      if (inFlight) return
      inFlight = true
      try {
        const response = await getOrders(
          { channel: 'storefront', status: 'new', page: 1, pageSize: WINDOW_SIZE },
          token,
        )
        if (cancelled) return
        const total = response.pagination.total
        setCount(total)

        const seen = seenIdsRef.current
        const currentIds = new Set(response.orders.map((order) => order.id))
        if (seen === null) {
          // Primera consulta: lo que ya estaba no se anuncia.
          seenIdsRef.current = currentIds
          lastTotalRef.current = total
          return
        }

        const fresh = response.orders.filter((order) => !seen.has(order.id))
        for (const id of currentIds) seen.add(id)
        const previousTotal = lastTotalRef.current
        lastTotalRef.current = total
        if (fresh.length === 0) return

        // En una rafaga mayor que la ventana, el total dice cuantos entraron realmente.
        const arrived = Math.max(fresh.length, total - previousTotal)
        setArrivalTick((tick) => tick + 1)
        setAlert({ orders: fresh, count: arrived, detectedAt: Date.now() })

        if (!enabledRef.current) return
        playChime(audioRef.current)
        if (currentNotificationState() === 'granted' && document.visibilityState === 'hidden') {
          try {
            const first = fresh[0]
            const notification = new Notification(
              arrived > 1 ? `${arrived} pedidos nuevos en la tienda` : `Nuevo pedido ${first.orderNumber}`,
              {
                body: arrived > 1 ? 'Abrí Pedidos para revisarlos.' : `${first.customerName} · ${first.itemCount} ítems`,
                tag: 'gastronexo-storefront-order',
              },
            )
            notification.onclick = () => {
              window.focus()
              notification.close()
            }
          } catch {
            // Algunos navegadores moviles no permiten new Notification() fuera de un service worker.
          }
        }
      } catch {
        // Sin conexion o sesion vencida: se reintenta en la proxima vuelta.
      } finally {
        inFlight = false
      }
    }

    void check()
    const timer = window.setInterval(() => void check(), POLL_MS)
    const onVisible = () => {
      if (document.visibilityState === 'visible') void check()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      cancelled = true
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [token, organizationId])

  // Contador en el titulo de la pestaña, visible aunque la consola este en segundo plano.
  useEffect(() => {
    const base = document.title.replace(/^\(\d+\)\s+/, '')
    document.title = count > 0 ? `(${count}) ${base}` : base
  }, [count])

  const toggleEnabled = useCallback(async () => {
    const next = !enabledRef.current
    setEnabled(next)
    writePreference(next)
    if (!next) return
    ensureAudio()
    playChime(audioRef.current) // confirma que el sonido funciona
    if (currentNotificationState() === 'default') {
      try {
        setNotificationState(await Notification.requestPermission())
      } catch {
        setNotificationState(currentNotificationState())
      }
    }
  }, [ensureAudio])

  const dismissAlert = useCallback(() => setAlert(null), [])

  return { count, alert, dismissAlert, enabled, toggleEnabled, notificationState, arrivalTick }
}
