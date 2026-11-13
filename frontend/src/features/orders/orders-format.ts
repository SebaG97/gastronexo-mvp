// Mision 9.1: textos y formatos compartidos del modulo de pedidos (tablero, detalle, formulario).
import type { OrderStatus, StorefrontPaymentMethod } from '../../shared/lib/auth-api'

const moneyFormatter = new Intl.NumberFormat('es-PY', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
const quantityFormatter = new Intl.NumberFormat('es-PY', { minimumFractionDigits: 0, maximumFractionDigits: 3 })

export function formatMoney(value: string | number) {
  const numericValue = Number(value)
  return `Gs. ${moneyFormatter.format(Number.isFinite(numericValue) ? Math.round(numericValue) : 0)}`
}

export function formatQuantity(value: string | number) {
  const numericValue = Number(value)
  return quantityFormatter.format(Number.isFinite(numericValue) ? numericValue : 0)
}

export const paymentLabelByKey: Record<StorefrontPaymentMethod, string> = {
  cash: 'Efectivo',
  transfer: 'Transferencia',
  card_on_delivery: 'Tarjeta al recibir',
}

export const statusLabelByKey: Record<OrderStatus, string> = {
  new: 'Nuevo',
  confirmed: 'Confirmado',
  preparing: 'En preparación',
  ready: 'Listo',
  delivered: 'Entregado',
  cancelled: 'Cancelado',
}

export const statusToneByKey: Record<OrderStatus, 'success' | 'warning' | 'danger' | 'info'> = {
  new: 'warning',
  confirmed: 'info',
  preparing: 'warning',
  ready: 'success',
  delivered: 'success',
  cancelled: 'danger',
}

/** Texto del boton que lleva el pedido al estado indicado. */
export const transitionActionByStatus: Record<OrderStatus, string> = {
  new: 'Volver a nuevo',
  confirmed: 'Confirmar',
  preparing: 'Empezar preparación',
  ready: 'Marcar listo',
  delivered: 'Entregado',
  cancelled: 'Cancelar pedido',
}

/** Proximo paso "normal" de cada estado (el boton grande). Cancelar va aparte. */
export const nextStatusByStatus: Partial<Record<OrderStatus, OrderStatus>> = {
  new: 'confirmed',
  confirmed: 'preparing',
  preparing: 'ready',
  ready: 'delivered',
}

export const cancelReasons = ['El cliente lo canceló', 'Sin stock', 'No se pudo contactar al cliente', 'Pedido duplicado', 'Otro motivo']

/** "hace 5 min", "hace 2 h", "ayer"... */
export function timeAgo(iso: string, now = Date.now()) {
  const minutes = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60000))
  if (minutes < 1) return 'recién'
  if (minutes < 60) return `hace ${minutes} min`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `hace ${hours} h`
  const days = Math.round(hours / 24)
  return days === 1 ? 'ayer' : `hace ${days} días`
}

function addDays(isoDate: string, days: number) {
  const date = new Date(`${isoDate}T12:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

export type DeliveryBucket = 'overdue' | 'today' | 'tomorrow' | 'later' | 'none'

/** Cuando hay que entregar, respecto de "hoy" del negocio (fechas YYYY-MM-DD). */
export function deliveryBucket(requestedDeliveryDate: string | null, today: string): DeliveryBucket {
  if (!requestedDeliveryDate) return 'none'
  const date = requestedDeliveryDate.slice(0, 10)
  if (date < today) return 'overdue'
  if (date === today) return 'today'
  if (date === addDays(today, 1)) return 'tomorrow'
  return 'later'
}

export function formatShortDate(isoDate: string) {
  const [, month, day] = isoDate.slice(0, 10).split('-')
  return `${day}/${month}`
}

export function deliveryLabel(requestedDeliveryDate: string | null, today: string) {
  const bucket = deliveryBucket(requestedDeliveryDate, today)
  if (bucket === 'none') return null
  if (bucket === 'today') return 'Entrega hoy'
  if (bucket === 'tomorrow') return 'Entrega mañana'
  if (bucket === 'overdue') return `Atrasado (${formatShortDate(requestedDeliveryDate!)})`
  return `Entrega ${formatShortDate(requestedDeliveryDate!)}`
}

/** Link de WhatsApp para un telefono paraguayo escrito como sea ("0981 123 456", "+595 981..."). */
export function whatsappLink(phone: string, text?: string) {
  let digits = phone.replace(/\D/g, '')
  if (digits.startsWith('0')) digits = `595${digits.slice(1)}`
  else if (!digits.startsWith('595') && digits.length <= 10) digits = `595${digits}`
  return `https://wa.me/${digits}${text ? `?text=${encodeURIComponent(text)}` : ''}`
}

export function phoneLink(phone: string) {
  return `tel:${phone.replace(/[^\d+]/g, '')}`
}

export function mapsLink(address: string) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`
}
