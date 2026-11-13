// Mision 9.1: tablero de pedidos. En escritorio, una columna por estado; en celular, pestanas
// con contador y una sola columna de tarjetas. Cada tarjeta tiene el boton del proximo paso.
import { Search } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { BoardOrder, OrderStatus } from '../../shared/lib/auth-api'
import {
  deliveryBucket,
  deliveryLabel,
  formatMoney,
  nextStatusByStatus,
  paymentLabelByKey,
  statusLabelByKey,
  timeAgo,
  transitionActionByStatus,
  type DeliveryBucket,
} from './orders-format'

type ColumnKey = 'new' | 'confirmed' | 'preparing' | 'ready' | 'closed'

const columns: Array<{ key: ColumnKey; title: string; empty: string }> = [
  { key: 'new', title: 'Nuevos', empty: 'No hay pedidos nuevos.' },
  { key: 'confirmed', title: 'Confirmados', empty: 'Nada confirmado esperando preparación.' },
  { key: 'preparing', title: 'En preparación', empty: 'No hay pedidos en preparación.' },
  { key: 'ready', title: 'Listos', empty: 'No hay pedidos listos para entregar.' },
  { key: 'closed', title: 'Cerrados hoy', empty: 'Todavía no se entregó ni canceló nada hoy.' },
]

type DeliveryFilter = 'all' | 'today' | 'tomorrow' | 'overdue'
const deliveryFilters: Array<{ key: DeliveryFilter; label: string }> = [
  { key: 'all', label: 'Todas las entregas' },
  { key: 'overdue', label: 'Atrasados' },
  { key: 'today', label: 'Hoy' },
  { key: 'tomorrow', label: 'Mañana' },
]

const bucketPriority: Record<DeliveryBucket, number> = { overdue: 0, today: 1, tomorrow: 2, later: 3, none: 4 }

function columnOf(status: OrderStatus): ColumnKey {
  return status === 'delivered' || status === 'cancelled' ? 'closed' : status
}

type OrdersBoardProps = {
  orders: BoardOrder[]
  today: string
  canWrite: boolean
  pendingOrderId: string | null
  onOpen: (orderId: string) => void
  onAdvance: (order: BoardOrder, nextStatus: OrderStatus) => void
}

export function OrdersBoard({ orders, today, canWrite, pendingOrderId, onOpen, onAdvance }: OrdersBoardProps) {
  const [search, setSearch] = useState('')
  const [deliveryFilter, setDeliveryFilter] = useState<DeliveryFilter>('all')
  const [activeColumn, setActiveColumn] = useState<ColumnKey>('new')
  const [now, setNow] = useState(() => Date.now())

  // Refresca los "hace X min" sin recargar datos.
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000)
    return () => window.clearInterval(timer)
  }, [])

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase()
    return orders.filter((order) => {
      if (term && !`${order.orderNumber} ${order.customerName} ${order.itemsPreview ?? ''}`.toLowerCase().includes(term)) return false
      if (deliveryFilter !== 'all' && deliveryBucket(order.requestedDeliveryDate, today) !== deliveryFilter) return false
      return true
    })
  }, [orders, search, deliveryFilter, today])

  const byColumn = useMemo(() => {
    const grouped: Record<ColumnKey, BoardOrder[]> = { new: [], confirmed: [], preparing: [], ready: [], closed: [] }
    for (const order of filtered) grouped[columnOf(order.status)].push(order)
    for (const key of ['new', 'confirmed', 'preparing', 'ready'] as const) {
      // Primero lo atrasado y lo de hoy; despues, el mas viejo primero.
      grouped[key].sort(
        (a, b) =>
          bucketPriority[deliveryBucket(a.requestedDeliveryDate, today)] - bucketPriority[deliveryBucket(b.requestedDeliveryDate, today)] ||
          a.createdAt.localeCompare(b.createdAt),
      )
    }
    grouped.closed.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    return grouped
  }, [filtered, today])

  const overdueCount = useMemo(
    () => orders.filter((order) => columnOf(order.status) !== 'closed' && deliveryBucket(order.requestedDeliveryDate, today) === 'overdue').length,
    [orders, today],
  )

  return (
    <section className="orders-board" aria-label="Tablero de pedidos">
      <div className="orders-board__toolbar">
        <label className="orders-board__search">
          <Search size={18} aria-hidden="true" />
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Buscar número, cliente o producto"
            aria-label="Buscar pedidos"
          />
        </label>
        <div className="orders-board__filters" role="group" aria-label="Filtrar por entrega">
          {deliveryFilters.map((filter) => (
            <button
              key={filter.key}
              type="button"
              className={`chip${deliveryFilter === filter.key ? ' chip--active' : ''}${filter.key === 'overdue' && overdueCount > 0 ? ' chip--alert' : ''}`}
              aria-pressed={deliveryFilter === filter.key}
              onClick={() => setDeliveryFilter(filter.key)}
            >
              {filter.label}
              {filter.key === 'overdue' && overdueCount > 0 ? <span className="chip__count">{overdueCount}</span> : null}
            </button>
          ))}
        </div>
      </div>

      {/* Celular: pestanas por estado (en escritorio se ven todas las columnas). */}
      <div className="orders-board__tabs" role="tablist" aria-label="Estados">
        {columns.map((column) => (
          <button
            key={column.key}
            type="button"
            role="tab"
            aria-selected={activeColumn === column.key}
            className={`orders-board__tab${activeColumn === column.key ? ' orders-board__tab--active' : ''}`}
            onClick={() => setActiveColumn(column.key)}
          >
            {column.title}
            <span className="orders-board__tab-count">{byColumn[column.key].length}</span>
          </button>
        ))}
      </div>

      <div className="orders-board__columns">
        {columns.map((column) => (
          <div
            key={column.key}
            className={`orders-column orders-column--${column.key}${activeColumn === column.key ? ' orders-column--active' : ''}`}
          >
            <h2 className="orders-column__title">
              {column.title}
              <span className="orders-column__count">{byColumn[column.key].length}</span>
            </h2>
            <div className="orders-column__list">
              {byColumn[column.key].length === 0 ? <p className="orders-column__empty">{column.empty}</p> : null}
              {byColumn[column.key].map((order) => (
                <OrderCard
                  key={order.id}
                  order={order}
                  today={today}
                  now={now}
                  canWrite={canWrite}
                  isPending={pendingOrderId === order.id}
                  onOpen={onOpen}
                  onAdvance={onAdvance}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

type OrderCardProps = {
  order: BoardOrder
  today: string
  now: number
  canWrite: boolean
  isPending: boolean
  onOpen: (orderId: string) => void
  onAdvance: (order: BoardOrder, nextStatus: OrderStatus) => void
}

function OrderCard({ order, today, now, canWrite, isPending, onOpen, onAdvance }: OrderCardProps) {
  const bucket = deliveryBucket(order.requestedDeliveryDate, today)
  const isClosed = order.status === 'delivered' || order.status === 'cancelled'
  const delivery = isClosed ? null : deliveryLabel(order.requestedDeliveryDate, today)
  const nextStatus = nextStatusByStatus[order.status]
  const isFreshFromStore = order.channel === 'storefront' && order.status === 'new'

  return (
    <article
      className={[
        'order-card',
        isFreshFromStore ? 'order-card--fresh' : '',
        !isClosed && bucket === 'overdue' ? 'order-card--overdue' : '',
        order.status === 'cancelled' ? 'order-card--cancelled' : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <button type="button" className="order-card__open" onClick={() => onOpen(order.id)} aria-label={`Abrir ${order.orderNumber} de ${order.customerName}`}>
        <span className="order-card__top">
          <strong className="order-card__number">{order.orderNumber}</strong>
          <span className="order-card__time">{isClosed ? statusLabelByKey[order.status] : timeAgo(order.createdAt, now)}</span>
        </span>
        <span className="order-card__customer">{order.customerName}</span>
        <span className="order-card__tags">
          <span className={`tag ${order.channel === 'storefront' ? 'tag--store' : ''}`}>{order.channel === 'storefront' ? 'Tienda' : 'Interno'}</span>
          {order.fulfillmentType ? <span className="tag">{order.fulfillmentType === 'delivery' ? 'Envío' : 'Retira'}</span> : null}
          {order.paymentMethod ? <span className="tag">{paymentLabelByKey[order.paymentMethod]}</span> : null}
          {delivery ? <span className={`tag tag--${bucket}`}>{delivery}</span> : null}
        </span>
        {order.itemsPreview ? <span className="order-card__items">{order.itemsPreview}</span> : null}
        <span className="order-card__bottom">
          <span>{order.itemCount} {order.itemCount === 1 ? 'producto' : 'productos'}</span>
          <strong>{formatMoney(order.total)}</strong>
        </span>
      </button>
      {canWrite && nextStatus ? (
        <button type="button" className="order-card__action" disabled={isPending} onClick={() => onAdvance(order, nextStatus)}>
          {isPending ? 'Actualizando…' : transitionActionByStatus[nextStatus]}
        </button>
      ) : null}
    </article>
  )
}
