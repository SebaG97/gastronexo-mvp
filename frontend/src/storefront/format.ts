const moneyFormatter = new Intl.NumberFormat('es-PY', { maximumFractionDigits: 0 })
const quantityFormatter = new Intl.NumberFormat('es-PY', { maximumFractionDigits: 3 })

export function formatMoney(value: number | string) {
  return `Gs. ${moneyFormatter.format(Math.round(Number(value)))}`
}

/** Solo el numero, para la etiqueta de precio donde "Gs." va aparte. */
export function formatAmount(value: number | string) {
  return moneyFormatter.format(Math.round(Number(value)))
}

const unitLabels: Record<string, { one: string; many: string; per: string }> = {
  unit: { one: 'unidad', many: 'unidades', per: 'la unidad' },
  kg: { one: 'kg', many: 'kg', per: 'el kilo' },
  g: { one: 'g', many: 'g', per: 'el gramo' },
  l: { one: 'litro', many: 'litros', per: 'el litro' },
  ml: { one: 'ml', many: 'ml', per: 'el ml' },
  box: { one: 'caja', many: 'cajas', per: 'la caja' },
  portion: { one: 'bandeja', many: 'bandejas', per: 'la bandeja' },
}

export function perUnitLabel(unit: string) {
  return unitLabels[unit]?.per ?? unit
}

export function formatQuantity(quantity: number | string, unit: string) {
  const value = Number(quantity)
  const label = unitLabels[unit] ?? { one: unit, many: unit }
  return `${quantityFormatter.format(value)} ${value === 1 ? label.one : label.many}`
}

/** Paso del selector de cantidad: medio kilo para peso/volumen, de a uno para unidades. */
export function quantityStep(unit: string) {
  return unit === 'kg' || unit === 'l' ? 0.5 : unit === 'g' || unit === 'ml' ? 100 : 1
}

export const paymentLabels: Record<string, string> = {
  cash: 'Efectivo',
  transfer: 'Transferencia',
  card_on_delivery: 'Tarjeta al recibir',
}

export const statusLabels: Record<string, string> = {
  new: 'Recibido, esperando confirmación',
  confirmed: 'Confirmado',
  preparing: 'En preparación',
  ready: 'Listo',
  delivered: 'Entregado',
  cancelled: 'Cancelado',
}
