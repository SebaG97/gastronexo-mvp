import { useCallback, useEffect, useState } from 'react'
import { storeApi, StoreApiError, type PublicOrder, type Store } from './api'
import { formatMoney, formatQuantity, paymentLabels, statusLabels } from './format'

export function Confirmation({
  slug,
  store,
  token,
  onContinue,
}: {
  slug: string
  store: Store
  token: string
  onContinue: () => void
}) {
  const [order, setOrder] = useState<PublicOrder | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const response = await storeApi.order(slug, token)
      setOrder(response.order)
      setError(null)
    } catch (loadError) {
      setError(loadError instanceof StoreApiError ? loadError.message : 'No pudimos cargar el pedido.')
    }
  }, [slug, token])

  useEffect(() => {
    void load()
    // El estado lo cambia el comercio: se refresca mientras la página está abierta.
    const timer = window.setInterval(() => void load(), 30000)
    return () => window.clearInterval(timer)
  }, [load])

  if (error && !order) {
    return (
      <main className="sf-state">
        <h1>No encontramos ese pedido</h1>
        <p>{error}</p>
        <button className="sf-btn sf-btn--primary" type="button" onClick={onContinue}>
          Ir a la tienda
        </button>
      </main>
    )
  }

  if (!order) {
    return (
      <main className="sf-state" aria-busy="true">
        <p>Cargando tu pedido…</p>
      </main>
    )
  }

  const whatsappText = encodeURIComponent(`Hola, hice el pedido ${order.orderNumber} en la tienda online.`)
  const whatsappUrl = store.whatsappPhone ? `https://wa.me/${store.whatsappPhone.replace(/\D/g, '')}?text=${whatsappText}` : null

  return (
    <main className="sf-done">
      <section className="sf-done__head" aria-live="polite">
        <h1>Recibimos tu pedido</h1>
        <p className="sf-done__number">
          <span>Número</span>
          <strong>{order.orderNumber}</strong>
        </p>
        <p>
          Gracias, {order.contactName.split(' ')[0]}. {store.name} lo va a revisar y te avisa por teléfono si hace falta
          confirmar algo.
        </p>
        <p className={`sf-status sf-status--${order.status}`}>{statusLabels[order.status]}</p>
      </section>

      <section className="sf-done__detail">
        <ul className="sf-done__items">
          {order.items.map((item, index) => (
            <li key={index}>
              <span>
                {formatQuantity(item.quantity, item.unit)} {item.name}
                {item.cutName && <small> en {item.cutName.toLowerCase()}</small>}
              </span>
              <span>{formatMoney(item.subtotal)}</span>
            </li>
          ))}
        </ul>
        <div className="sf-sum">
          <span>Productos</span>
          <span>{formatMoney(order.subtotal)}</span>
        </div>
        <div className="sf-sum">
          <span>Envío</span>
          <span>{Number(order.deliveryFee) > 0 ? formatMoney(order.deliveryFee) : 'Sin costo'}</span>
        </div>
        <div className="sf-sum sf-sum--total">
          <span>Total a pagar</span>
          <strong>{formatMoney(order.total)}</strong>
        </div>

        <dl className="sf-review">
          <div>
            <dt>Entrega</dt>
            <dd>
              {order.fulfillmentType === 'delivery'
                ? `${order.deliveryAddress}, ${order.deliveryZoneName}`
                : `Retiro en ${store.pickupAddress ?? 'el local'}`}
            </dd>
          </div>
          <div>
            <dt>Pago</dt>
            <dd>
              {paymentLabels[order.paymentMethod]}
              {order.cashChangeFor && `, pagás con ${formatMoney(order.cashChangeFor)}`}
            </dd>
          </div>
          {order.paymentMethod === 'transfer' && store.transferDetails && (
            <div>
              <dt>Datos para transferir</dt>
              <dd>{store.transferDetails}</dd>
            </div>
          )}
          {order.notes && (
            <div>
              <dt>Notas</dt>
              <dd>{order.notes}</dd>
            </div>
          )}
        </dl>

        <div className="sf-done__actions">
          {whatsappUrl && (
            <a className="sf-btn sf-btn--primary sf-btn--wide" href={whatsappUrl} target="_blank" rel="noreferrer">
              Escribir por WhatsApp
            </a>
          )}
          <button className="sf-btn sf-btn--wide" type="button" onClick={onContinue}>
            Hacer otro pedido
          </button>
        </div>
        <p className="sf-done__save">Guardá esta página para ver cómo avanza tu pedido.</p>
      </section>
    </main>
  )
}
