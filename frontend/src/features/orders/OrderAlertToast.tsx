import { useEffect } from 'react'
import { BellRing, X } from 'lucide-react'
import type { OrderAlert } from './useStorefrontOrderAlerts'

const moneyFormatter = new Intl.NumberFormat('es-PY', { maximumFractionDigits: 0 })

function formatMoney(value: string) {
  const amount = Number(value)
  return `Gs. ${moneyFormatter.format(Number.isFinite(amount) ? Math.round(amount) : 0)}`
}

// Se cierra solo despues de este tiempo; el contador del menu y del titulo siguen visibles.
const AUTO_DISMISS_MS = 30_000

type OrderAlertToastProps = {
  alert: OrderAlert | null
  onOpen: (orderId: string | null) => void
  onDismiss: () => void
}

export function OrderAlertToast({ alert, onOpen, onDismiss }: OrderAlertToastProps) {
  useEffect(() => {
    if (!alert) return
    const timer = window.setTimeout(onDismiss, AUTO_DISMISS_MS)
    return () => window.clearTimeout(timer)
  }, [alert, onDismiss])

  if (!alert) return null
  const first = alert.orders[0]
  const isSingle = alert.count === 1 && first

  return (
    <div className="order-toast" role="status" aria-live="polite">
      <span className="order-toast__icon" aria-hidden="true">
        <BellRing size={18} />
      </span>
      <div className="order-toast__body">
        <p className="order-toast__title">
          {isSingle ? `Nuevo pedido ${first.orderNumber}` : `${alert.count} pedidos nuevos de la tienda`}
        </p>
        <p className="order-toast__detail">
          {isSingle
            ? `${first.customerName} · ${first.itemCount} ${first.itemCount === 1 ? 'ítem' : 'ítems'} · ${formatMoney(first.total)}`
            : 'Entraron por la tienda online y esperan confirmación.'}
        </p>
        <button
          className="button button--primary order-toast__action"
          type="button"
          onClick={() => onOpen(isSingle ? first.id : null)}
        >
          {isSingle ? 'Ver pedido' : 'Ver pedidos'}
        </button>
      </div>
      <button aria-label="Cerrar aviso" className="order-toast__close" type="button" onClick={onDismiss}>
        <X size={16} />
      </button>
    </div>
  )
}
