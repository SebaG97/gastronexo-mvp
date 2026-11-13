import { Minus, Plus, Trash2, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { storeApi, type Quote, type Store } from './api'
import { formatMoney, formatQuantity, quantityStep } from './format'
import { lineKey, type Cart } from './useCart'

const issueLabels: Record<string, string> = {
  unavailable: 'Ya no está a la venta',
  out_of_stock: 'Sin stock hoy',
  invalid_quantity: 'Se vende por unidad entera',
  invalid_cut: 'Ese corte ya no está disponible',
}

/** Recotiza el carrito contra el backend cuando cambia, con una pequeña espera. */
export function useCartQuote(slug: string, cart: Cart, options: { fulfillmentType?: 'pickup' | 'delivery'; deliveryZoneId?: string | null } = {}) {
  const [quote, setQuote] = useState<Quote | null>(null)
  const [isQuoting, setIsQuoting] = useState(false)
  const signature = JSON.stringify([cart.lines.map((line) => [line.productId, line.cutTypeId, line.quantity]), options])
  const { syncWithQuote } = cart

  useEffect(() => {
    if (cart.lines.length === 0) {
      setQuote(null)
      return
    }
    let cancelled = false
    setIsQuoting(true)
    const timer = window.setTimeout(async () => {
      try {
        const response = await storeApi.quote(slug, {
          items: cart.lines.map(({ productId, cutTypeId, quantity }) => ({ productId, cutTypeId, quantity })),
          ...options,
        })
        if (!cancelled) {
          setQuote(response.quote)
          syncWithQuote(response.quote)
        }
      } catch {
        if (!cancelled) {
          setQuote(null)
        }
      } finally {
        if (!cancelled) {
          setIsQuoting(false)
        }
      }
    }, 350)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, slug])

  return { quote, isQuoting }
}

export function issueFor(quote: Quote | null, key: string) {
  const item = quote?.items.find((candidate) => lineKey(candidate) === key)
  return item && item.status !== 'ok' ? issueLabels[item.status] : null
}

export function CartPanel({
  store,
  cart,
  isOpen,
  onClose,
  onCheckout,
}: {
  store: Store
  cart: Cart
  isOpen: boolean
  onClose: () => void
  onCheckout: () => void
}) {
  const { quote } = useCartQuote(store.slug, cart)
  const minOrder = Number(store.minOrderAmount)
  const missing = Math.max(0, minOrder - cart.subtotal)
  const hasIssues = quote?.hasIssues ?? false

  useEffect(() => {
    if (!isOpen) {
      return
    }
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isOpen, onClose])

  return (
    <>
      {isOpen && <div className="sf-scrim" onClick={onClose} aria-hidden="true" />}
      <aside className={`sf-cart${isOpen ? ' is-open' : ''}`} aria-label="Tu pedido">
        <div className="sf-cart__head">
          <h2>Tu pedido</h2>
          <button className="sf-icon-btn sf-cart__close" type="button" onClick={onClose} aria-label="Cerrar pedido">
            <X size={20} />
          </button>
        </div>

        {cart.lastRemoved && (
          <div className="sf-undo" role="status">
            <span>Quitaste {cart.lastRemoved.line.name}.</span>
            <button type="button" onClick={cart.undoRemove}>
              Deshacer
            </button>
          </div>
        )}

        {cart.lines.length === 0 ? (
          <p className="sf-cart__empty">Todavía no agregaste nada. Elegí productos de la lista y aparecen acá.</p>
        ) : (
          <>
            <ul className="sf-lines">
              {cart.lines.map((line) => {
                const key = lineKey(line)
                const issue = issueFor(quote, key)
                const step = quantityStep(line.unit)
                return (
                  <li key={key} className={issue ? 'has-issue' : undefined}>
                    <div className="sf-line__name">
                      <strong>{line.name}</strong>
                      {line.cutName && <span>{line.cutName}</span>}
                      {issue && <em>{issue}</em>}
                    </div>
                    <div className="sf-line__qty">
                      <button
                        type="button"
                        aria-label={`Quitar ${formatQuantity(step, line.unit)} de ${line.name}`}
                        onClick={() => cart.setQuantity(key, Number((line.quantity - step).toFixed(3)))}
                      >
                        {line.quantity - step <= 0 ? <Trash2 size={15} /> : <Minus size={15} />}
                      </button>
                      <span>{formatQuantity(line.quantity, line.unit)}</span>
                      <button
                        type="button"
                        aria-label={`Agregar ${formatQuantity(step, line.unit)} de ${line.name}`}
                        onClick={() => cart.setQuantity(key, Number((line.quantity + step).toFixed(3)))}
                      >
                        <Plus size={15} />
                      </button>
                    </div>
                    <span className="sf-line__total">{formatMoney(Math.round(line.quantity * line.unitPrice))}</span>
                  </li>
                )
              })}
            </ul>

            <div className="sf-cart__foot">
              <div className="sf-sum">
                <span>Subtotal</span>
                <strong>{formatMoney(cart.subtotal)}</strong>
              </div>
              <p className="sf-cart__hint">El envío se calcula en el siguiente paso.</p>
              {missing > 0 && (
                <div className="sf-minimum">
                  <p>Te faltan {formatMoney(missing)} para el pedido mínimo.</p>
                  <div className="sf-minimum__bar" aria-hidden="true">
                    <span style={{ width: `${Math.min(100, (cart.subtotal / minOrder) * 100)}%` }} />
                  </div>
                </div>
              )}
              {hasIssues && <p className="sf-alert">Quitá o cambiá los productos marcados para seguir.</p>}
              <button
                className="sf-btn sf-btn--primary sf-btn--wide"
                type="button"
                disabled={missing > 0 || hasIssues}
                onClick={onCheckout}
              >
                Finalizar pedido
              </button>
              <button className="sf-btn sf-btn--ghost sf-btn--wide sf-cart__continue" type="button" onClick={onClose}>
                Seguir comprando
              </button>
            </div>
          </>
        )}
      </aside>
    </>
  )
}
